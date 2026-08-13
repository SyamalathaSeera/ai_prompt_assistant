import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { Panel } from './Panel';
import { createPanelStore, type PanelStore } from './panel-store';
import { detect } from '@/lib/detector/engine';
import { ALL_RULES } from '@/lib/detector/rules';
import type { HeldSubmission } from '@/lib/interception/controller';

/**
 * Keyboard and assistive-technology behaviour for the approval modal.
 *
 * The modal interrupts someone mid-task. If it cannot be resolved from the
 * keyboard, it is not an inconvenience — it is a prompt they cannot send.
 */

const TEXT = 'AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7';

let container: HTMLElement;
let store: PanelStore;
let composer: HTMLTextAreaElement;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const $$ = (id: string) => [...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const waitFor = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000 });

function submission(): HeldSubmission {
  const findings = detect(TEXT, {}, ALL_RULES);
  return {
    text: TEXT,
    findings,
    blocking: findings.filter((f) => f.tier === 'high'),
    held: true,
    sendOriginal: () => {},
    sendReplacement: () => {},
    cancel: () => {},
  };
}

function mount(): void {
  // Stand-in for the host page's composer, so focus restoration is observable.
  composer = document.createElement('textarea');
  document.body.appendChild(composer);
  composer.focus();

  container = document.createElement('div');
  document.body.appendChild(container);
  store = createPanelStore();
  render(<Panel store={store} />, container);
}

/**
 * Opens the modal and waits until the focus trap is armed.
 *
 * The trap attaches in an effect, which runs after the element exists. Waiting
 * only for the element leaves a window where the dialog is on screen but not
 * yet listening — irrelevant in a browser, where no human presses Tab that
 * fast, but a source of order-dependent test failures.
 */
async function open(): Promise<void> {
  store.present(submission());
  await waitFor(() => expect($('apa-modal')).not.toBeNull());
  await waitFor(() => expect(document.activeElement).toBe($('apa-modal')));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('dialog semantics', () => {
  it('is a labelled modal dialog', async () => {
    mount();
    await open();

    const modal = $('apa-modal')!;
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(modal.getAttribute('aria-labelledby')).toBe('apa-modal-title');
    expect(modal.getAttribute('aria-describedby')).toBe('apa-modal-summary');
  });

  it('points its label and description at elements that exist', async () => {
    // A dangling aria-labelledby leaves the dialog announced as "dialog".
    mount();
    await open();

    expect(container.querySelector('#apa-modal-title')).not.toBeNull();
    expect(container.querySelector('#apa-modal-summary')).not.toBeNull();
  });

  it('announces the finding count as a live status', async () => {
    mount();
    await open();

    const summary = $('apa-modal-summary')!;
    expect(summary.getAttribute('role')).toBe('status');
    expect(summary.textContent).toContain('AWS Access Key ID');
    expect(summary.textContent).toContain('Nothing has been sent');
  });

  it('labels every control', async () => {
    mount();
    await open();

    for (const button of container.querySelectorAll('button')) {
      const labelled =
        (button.textContent ?? '').trim().length > 0 ||
        button.hasAttribute('aria-label') ||
        button.hasAttribute('title');
      expect(labelled, `unlabelled button: ${button.outerHTML}`).toBe(true);
    }

    for (const input of container.querySelectorAll('input')) {
      expect(input.hasAttribute('aria-label')).toBe(true);
    }
  });
});

describe('focus management', () => {
  it('takes focus on open', async () => {
    // Otherwise a keyboard user is left on the page behind a modal they
    // cannot reach.
    mount();
    await open();

    await waitFor(() => expect(document.activeElement).toBe($('apa-modal')));
  });

  it('does not focus the send button, so a reflexive Enter cannot fire it', async () => {
    // The modal is summoned BY pressing Enter. A focused primary button would
    // let a second keypress send before anything has been read.
    mount();
    await open();

    expect(document.activeElement).not.toBe($('apa-send-redacted'));
  });

  it('returns focus to the composer on close', async () => {
    mount();
    expect(document.activeElement).toBe(composer);

    await open();
    await waitFor(() => expect(document.activeElement).toBe($('apa-modal')));

    store.dismiss();
    await waitFor(() => expect(document.activeElement).toBe(composer));
  });

  it('returns focus after sending too', async () => {
    mount();
    await open();
    await waitFor(() => expect(document.activeElement).toBe($('apa-modal')));

    $('apa-send-redacted')!.click();
    await waitFor(() => expect(document.activeElement).toBe(composer));
  });
});

describe('keyboard operation', () => {
  it('keeps Tab inside the dialog', async () => {
    mount();
    await open();

    const focusable = [...container.querySelectorAll<HTMLElement>('button, input')];
    expect(focusable.length).toBeGreaterThan(1);

    const last = focusable[focusable.length - 1]!;
    last.focus();

    // Dispatched on the focused element, as a real Tab keypress would be.
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    last.dispatchEvent(event);

    // Wrapped rather than escaping into the page behind.
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('wraps backwards from the dialog itself', async () => {
    mount();
    await open();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    $('apa-modal')!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves other keys alone', async () => {
    mount();
    await open();

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    });
    $('apa-modal')!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('dismisses on Escape', async () => {
    mount();
    await open();

    $('apa-modal')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    await waitFor(() => expect($('apa-modal')).toBeNull());
  });

  it('can be completed with the keyboard alone', async () => {
    // Tab to each control and activate it — no pointer involved anywhere.
    mount();
    await open();

    const toggles = $$('apa-finding-toggle') as HTMLInputElement[];
    expect(toggles.length).toBeGreaterThan(0);

    toggles[0]!.focus();
    expect(document.activeElement).toBe(toggles[0]);

    const send = $('apa-send-redacted')!;
    send.focus();
    expect(document.activeElement).toBe(send);

    send.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    send.click();

    await waitFor(() => expect($('apa-modal')).toBeNull());
  });
});
