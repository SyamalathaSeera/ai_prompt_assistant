import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { Welcome } from './Welcome';
import { __resetCacheForTests } from '@/lib/storage';
import { __resetForTests as resetSession } from '@/lib/model/session';
import { detect } from '@/lib/detector/engine';

/**
 * The first-run demo.
 *
 * The property under test throughout is that this page shows the **real thing**.
 * A welcome page that demonstrated a mock would keep working perfectly after the
 * product broke, and would be teaching the user something false — which for a
 * security tool is worse than teaching them nothing.
 */

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';
const DB_PASSWORD = 'hunter2pass';

let container: HTMLElement;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const waitFor = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000 });

beforeEach(() => {
  fakeBrowser.reset();
  __resetCacheForTests();
  container = document.createElement('div');
  document.body.append(container);
  render(<Welcome />, container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('the demo runs the real detector', () => {
  it('catches the sample the same way the detector does', async () => {
    /*
     * Not "the modal opened" — that a mock could fake. This asserts the page's
     * sample text produces findings when run through the detector directly, so
     * a rule change that stopped catching it would fail here rather than
     * leaving onboarding quietly demonstrating nothing.
     */
    const sample = ($('welcome-composer') as HTMLTextAreaElement).value;

    const findings = detect(sample);
    const blocking = findings.filter((f) => f.tier === 'high');

    expect(blocking.length).toBeGreaterThanOrEqual(2);
    expect(sample).toContain(AWS_KEY);
    expect(sample).toContain(DB_PASSWORD);
  });

  it('opens the real approval modal', async () => {
    $('welcome-try')?.click();

    // apa-modal is the production component, imported not reimplemented.
    await waitFor(() => expect($('apa-modal')).not.toBeNull());
    expect($('apa-finding-list')).not.toBeNull();
  });

  it('names what it found without printing the value', async () => {
    $('welcome-try')?.click();
    await waitFor(() => expect($('apa-finding-list')).not.toBeNull());

    const list = $('apa-finding-list')?.textContent ?? '';
    expect(list).toContain('AWS');
    expect(list).not.toContain(AWS_KEY);
  });

  it('shows a redacted result that still reads as the original request', async () => {
    $('welcome-try')?.click();
    await waitFor(() => expect($('apa-send-redacted')).not.toBeNull());

    $('apa-send-redacted')?.click();
    await waitFor(() => expect($('welcome-outcome')).not.toBeNull());

    const sent = $('welcome-outcome-text')?.textContent ?? '';

    expect(sent).not.toContain(AWS_KEY);
    expect(sent).not.toContain(DB_PASSWORD);
    expect(sent).toContain('[REDACTED_');

    /*
     * The point the demo has to land: the request survives redaction.
     *
     * Asserted on the surrounding structure rather than on any particular
     * value. An earlier version checked that `db.internal` was still there —
     * but the detector redacts internal hostnames too, and correctly. What
     * matters is that the shape of the request is intact enough for a model to
     * answer it.
     */
    expect(sent).toContain('Deploy the billing service');
    expect(sent).toContain('postgres://app:');
    expect(sent).toContain(':5432/orders');
  });
});

describe('the sample is safe to ship', () => {
  it('uses values that announce themselves as fake', async () => {
    /*
     * This text appears in every screenshot anyone ever takes of onboarding.
     * A plausible-looking live key would be a liability, and a demo that
     * normalises pasting real credentials into a tool is teaching the opposite
     * of the lesson.
     */
    const sample = ($('welcome-composer') as HTMLTextAreaElement).value;

    expect(sample).toContain('SYNTHETIC');
    // A hostname that resolves nowhere.
    expect(sample).toContain('db.internal');
  });
});

describe('reaching the first catch quickly', () => {
  it('is pre-filled, so nothing has to be typed', () => {
    // The 30-second budget is mostly a typing budget. Removing the typing is
    // what makes it achievable, not asking the user to hurry.
    const composer = $('welcome-composer') as HTMLTextAreaElement;
    expect(composer.value.trim().length).toBeGreaterThan(0);
  });

  it('reaches a real catch in a single click', async () => {
    $('welcome-try')?.click();
    await waitFor(() => expect($('apa-modal')).not.toBeNull());
  });

  it('asks for no account, signup, or email', () => {
    /*
     * Stated in the spec and worth pinning: the fastest way to lose someone
     * between install and first use is a form.
     *
     * Asserted on inputs rather than on copy. An earlier version searched the
     * text for "sign up" and failed on the page's own sentence — "nothing to
     * sign up for" — which is the promise, not a violation of it.
     */
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    // One textarea, and it is the demo composer.
    const inputs = container.querySelectorAll('textarea');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.getAttribute('data-testid')).toBe('welcome-composer');
  });

  it('points the user at a real chat once the demo is done', () => {
    expect($('welcome-open-chatgpt')).not.toBeNull();
  });
});

describe('honesty about what happens', () => {
  it('says nothing is actually sent from this page', () => {
    expect(container.textContent).toContain('Nothing is actually sent');
  });

  it('reports a clean draft as clean rather than manufacturing a catch', async () => {
    const composer = $('welcome-composer') as HTMLTextAreaElement;
    composer.value = 'What is the capital of France?';
    composer.dispatchEvent(new Event('input', { bubbles: true }));

    await waitFor(() => {
      expect(($('welcome-composer') as HTMLTextAreaElement).value).toBe(
        'What is the capital of France?',
      );
    });

    $('welcome-try')?.click();

    await waitFor(() => expect($('welcome-outcome')).not.toBeNull());
    expect($('apa-modal')).toBeNull();
    expect($('welcome-outcome-text')?.textContent).toContain('capital of France');
  });

  it('leaves the draft alone when the user dismisses', async () => {
    $('welcome-try')?.click();
    await waitFor(() => expect($('apa-modal')).not.toBeNull());

    // Escape is the dismissal gesture in the real modal too.
    $('apa-modal')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    await waitFor(() => expect($('apa-modal')).toBeNull());

    const composer = $('welcome-composer') as HTMLTextAreaElement;
    expect(composer.value).toContain(AWS_KEY);
  });
});

describe('the on-device model requirement', () => {
  /*
   * Prompt improvement is the only feature here that can be absent, and the
   * composer button is hidden rather than disabled when it is. That leaves this
   * page as the only thing standing between "my machine cannot run it" and "this
   * extension is broken" — which is the difference between a shrug and a review.
   *
   * Remounts rather than relying on the outer render: availability is read in an
   * effect with no dependencies, so the global must be stubbed before mount.
   */
  const remount = () => {
    render(null, container);
    render(<Welcome />, container);
  };

  const installModel = (availability: string) => {
    vi.stubGlobal('LanguageModel', {
      availability: async () => availability,
      create: async () => ({ prompt: async () => '', destroy: () => {} }),
    });
  };

  beforeEach(() => {
    // The session is module-level and now reachable from this page, so a
    // download in one test would satisfy the next one's availability check.
    resetSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetSession();
  });

  it('explains the absence instead of leaving a button that never appears', async () => {
    // No stub: this is Firefox, an older Chrome, or hardware that cannot run it.
    remount();

    await waitFor(() => expect($('welcome-model-state')).not.toBeNull());
    expect($('welcome-model-state')!.textContent).toContain('does not provide');
  });

  it('says protection still works without a model', async () => {
    /*
     * The load-bearing sentence. Someone told a feature is unavailable will
     * reasonably assume the whole extension is, and uninstall something that is
     * protecting them perfectly.
     */
    remount();

    await waitFor(() => expect($('welcome-model-note')).not.toBeNull());
    const text = $('welcome-model-note')!.textContent ?? '';
    expect(text).toContain('without it');
    expect(text).toContain('redacted');
  });

  it('does not promise a shortcut the machine cannot run', async () => {
    remount();

    await waitFor(() => expect($('welcome-model-state')).not.toBeNull());
    expect($('welcome-model-note')!.textContent).not.toContain('Alt+Shift+I');
    // Nor a download, on a machine where downloading would change nothing.
    expect($('model-download')).toBeNull();
  });

  it('says where the button is when the model is ready', async () => {
    installModel('available');
    remount();

    await waitFor(() => expect($('welcome-model-state')).not.toBeNull());
    const text = $('welcome-model-state')!.textContent ?? '';
    expect(text).toContain('Improve');
    expect(text).toContain('Alt+Shift+I');
    // Already downloaded — offering to fetch it again would be nonsense.
    expect($('model-download')).toBeNull();
  });

  it('offers the download here rather than sending the user elsewhere', async () => {
    /*
     * This page is where someone finds out the feature is missing. Reporting
     * that and handing them a link to settings is a dead end dressed as a way
     * out, so the real control renders here — the same component settings
     * uses, not a copy of it.
     */
    installModel('downloadable');
    remount();

    await waitFor(() => expect($('model-download')).not.toBeNull());
    expect($('welcome-model-state')!.textContent).toContain('one-time');
    expect($('model-download')!.textContent).toContain('Download');
  });

  it('starts the download from the welcome page itself', async () => {
    // The property that separates this from the link it replaced.
    const create = vi.fn(async () => ({ prompt: async () => '', destroy: () => {} }));
    vi.stubGlobal('LanguageModel', { availability: async () => 'downloadable', create });
    remount();

    await waitFor(() => expect($('model-download')).not.toBeNull());
    $('model-download')!.click();

    await waitFor(() => expect(create).toHaveBeenCalled());
  });

  it('never asks the user for a key or an account', async () => {
    /*
     * The question this note exists to pre-empt: "which AI is this, and where
     * does my key go?" The answer has to be visible without opening settings.
     */
    installModel('available');
    remount();

    await waitFor(() => expect($('welcome-model-note')).not.toBeNull());
    const text = $('welcome-model-note')!.textContent ?? '';
    expect(text).toContain('your own machine');
    expect(text).toContain('no key');
    // Still no inputs anywhere on the page.
    expect(container.querySelector('input')).toBeNull();
  });
});
