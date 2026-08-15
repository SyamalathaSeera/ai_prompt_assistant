import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { Welcome } from './Welcome';
import { __resetCacheForTests } from '@/lib/storage';
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
