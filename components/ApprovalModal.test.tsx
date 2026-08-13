import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { Panel } from './Panel';
import { createPanelStore, type PanelStore } from './panel-store';
import { detect } from '@/lib/detector/engine';
import { ALL_RULES } from '@/lib/detector/rules';
import type { HeldSubmission } from '@/lib/interception/controller';

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';
const TEXT = `AWS_ACCESS_KEY_ID=${AWS_KEY}`;

interface Recorder {
  submission: HeldSubmission;
  originals: () => number;
  replacements: () => string[];
  cancels: () => number;
}

function makeSubmission(text = TEXT): Recorder {
  const findings = detect(text, {}, ALL_RULES);
  let originals = 0;
  let cancels = 0;
  const replacements: string[] = [];

  return {
    submission: {
      text,
      findings,
      blocking: findings.filter((f) => f.tier === 'high'),
      held: true,
      sendOriginal: () => {
        originals += 1;
      },
      sendReplacement: (r) => {
        replacements.push(r);
      },
      cancel: () => {
        cancels += 1;
      },
    },
    originals: () => originals,
    replacements: () => replacements,
    cancels: () => cancels,
  };
}

let container: HTMLElement;
let store: PanelStore;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/**
 * Waits for a condition rather than for a fixed number of ticks.
 *
 * Preact schedules effects on a macrotask and batches updates on a microtask,
 * so render → effect → subscribe → re-render spans several turns. Counting
 * ticks produced tests that passed or failed depending on scheduling, and a
 * flaky test is worse than no test: it trains everyone to re-run instead of
 * to investigate.
 */
const waitFor = (assertion: () => void) => vi.waitFor(assertion, { timeout: 1000 });

const seeModal = () => waitFor(() => expect($('apa-modal')).not.toBeNull());
const modalGone = () => waitFor(() => expect($('apa-modal')).toBeNull());

function mount(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  store = createPanelStore();
  render(<Panel store={store} />, container);
}

/** Presents a submission and waits until the modal is actually on screen. */
async function present(rec: Recorder = makeSubmission()): Promise<Recorder> {
  store.present(rec.submission);
  await seeModal();
  return rec;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('visibility', () => {
  it('renders nothing while idle', async () => {
    mount();
    await waitFor(() => expect($('apa-panel')).not.toBeNull());
    expect($('apa-modal')).toBeNull();
  });

  it('appears when a submission is held', async () => {
    mount();
    await present();
    expect($('apa-modal')).not.toBeNull();
  });

  it('disappears once resolved', async () => {
    mount();
    await present();

    store.dismiss();
    await modalGone();
  });
});

describe('what it shows', () => {
  it('summarises what was found', async () => {
    mount();
    await present();

    expect($('apa-modal-summary')!.textContent).toContain('AWS Access Key ID');
  });

  it('previews the redacted prompt, not the original', async () => {
    mount();
    await present();

    const preview = $('apa-preview')!.textContent ?? '';
    expect(preview).toContain('[REDACTED_');
    expect(preview).not.toContain(AWS_KEY);
  });

  it('never renders the secret anywhere in the modal', async () => {
    // The modal exists to prevent a leak; putting the value back on screen in
    // a panel over a shared screen would be its own small one.
    mount();
    await present();

    expect($('apa-modal')!.textContent).not.toContain(AWS_KEY);
  });

  it('says nothing has been sent yet', async () => {
    mount();
    await present();

    expect($('apa-modal')!.textContent).toContain('Nothing has been sent yet');
  });
});

describe('actions', () => {
  it('sends the redacted prompt', async () => {
    mount();
    const rec = await present();

    $('apa-send-redacted')!.click();
    await modalGone();

    expect(rec.replacements()).toHaveLength(1);
    expect(rec.replacements()[0]).toContain('[REDACTED_');
    expect(rec.replacements()[0]).not.toContain(AWS_KEY);
  });

  it('requires two clicks to send the original', async () => {
    // Enough friction that it cannot happen by reflex while dismissing,
    // but never blocked, because the user's judgement has to win.
    mount();
    const rec = await present();

    $('apa-send-original')!.click();
    await waitFor(() => expect($('apa-send-original-confirm')).not.toBeNull());
    expect(rec.originals()).toBe(0);

    $('apa-send-original-confirm')!.click();
    await modalGone();
    expect(rec.originals()).toBe(1);
  });

  it('sends exactly what the user edited', async () => {
    mount();
    const rec = await present();

    $('apa-edit')!.click();
    await waitFor(() => expect($('apa-edit-field')).not.toBeNull());

    const field = $('apa-edit-field') as HTMLTextAreaElement;
    field.value = 'rewritten by hand';
    field.dispatchEvent(new Event('input', { bubbles: true }));

    await waitFor(() =>
      expect(($('apa-edit-field') as HTMLTextAreaElement).value).toBe(
        'rewritten by hand',
      ),
    );

    $('apa-send-redacted')!.click();
    await modalGone();

    expect(rec.replacements()).toEqual(['rewritten by hand']);
  });

  it('cancels without sending', async () => {
    mount();
    const rec = await present();

    $('apa-dismiss')!.click();
    await modalGone();

    expect(rec.originals()).toBe(0);
    expect(rec.replacements()).toEqual([]);
    expect(rec.cancels()).toBe(1);
  });

  it('dismisses on Escape without sending', async () => {
    mount();
    const rec = await present();

    $('apa-modal')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await modalGone();

    expect(rec.originals()).toBe(0);
    expect(rec.replacements()).toEqual([]);
  });

  it('does not send twice on a double click', async () => {
    mount();
    const rec = await present();

    const button = $('apa-send-redacted')!;
    button.click();
    button.click();
    await modalGone();

    expect(rec.replacements()).toHaveLength(1);
  });
});

describe('interaction surface', () => {
  it('opts back into pointer events', async () => {
    // The shadow host is pointer-events: none so it does not blanket the page.
    // The modal must opt back in or its own buttons would be unclickable.
    mount();
    await present();

    expect($('apa-modal-backdrop')!.className).toContain('pointer-events-auto');
  });

  it('is announced as a modal dialog', async () => {
    mount();
    await present();

    const modal = $('apa-modal')!;
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(modal.getAttribute('aria-labelledby')).toBe('apa-modal-title');
  });
});
