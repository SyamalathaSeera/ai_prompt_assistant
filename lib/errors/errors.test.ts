import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  clearErrors,
  formatForReport,
  getErrors,
  MAX_ERRORS,
  recordError,
  scrub,
} from './index';

/**
 * The local error log.
 *
 * It exists so a bug can be reported without the user pasting their prompt
 * into an issue tracker. That makes its correctness a privacy property, not a
 * diagnostics one — and the test that matters most is the one asserting what
 * it does NOT contain.
 */

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';

/**
 * A second real-shaped secret, for the stack test.
 *
 * Deliberately not `4111111111111111`: that is the universally published test
 * card, and the detector suppresses known placeholder values on purpose. Using
 * it here would have tested the suppressor rather than the scrubber — and it
 * did, which is how this comment came to exist.
 */
const STACK_SECRET = 'AKIA4QF9WXSYNTHETIC2';

beforeEach(() => {
  fakeBrowser.reset();
});

// Spies rather than direct assignment: `fakeBrowser.reset()` clears stored
// data but does not put back a method that was overwritten, so a hand-rolled
// stub leaks into every test that follows it.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('never persisting prompt content', () => {
  it('redacts a secret out of an error message', () => {
    // Rule 3 in CLAUDE.md applies to our own diagnostics exactly as it applies
    // to logs. A crash report is not an exception.
    const scrubbed = scrub(`failed while handling ${AWS_KEY}`);

    expect(scrubbed).not.toContain(AWS_KEY);
    expect(scrubbed).toContain('[REDACTED_');
  });

  it('redacts a secret out of a recorded error', async () => {
    await recordError('test.stage', new Error(`boom near ${AWS_KEY}`));

    const logged = await getErrors();
    expect(logged).toHaveLength(1);
    expect(logged[0]?.message).not.toContain(AWS_KEY);
  });

  it('redacts a secret out of a stack', async () => {
    const error = new Error('boom');
    error.stack = `Error: boom\n  at send (chrome-extension://x/${STACK_SECRET}.js:1:1)`;

    await recordError('test.stage', error);

    const logged = await getErrors();
    expect(logged[0]?.stack).not.toContain(STACK_SECRET);
  });

  it('truncates, so anything the detector missed is still bounded', async () => {
    // The second line of defence. Some framework errors quote the input that
    // caused them, and not every quote is a shape the detector knows.
    await recordError('test.stage', new Error('x'.repeat(5000)));

    const logged = await getErrors();
    expect(logged[0]?.message.length).toBeLessThan(1000);
  });

  it('scrubs the stage label too', async () => {
    // Callers pass constants by convention, and conventions rot.
    await recordError(`stage ${AWS_KEY}`, new Error('boom'));

    const logged = await getErrors();
    expect(logged[0]?.where).not.toContain(AWS_KEY);
  });

  it('handles a non-Error throw the same way', async () => {
    // DOM code throws strings and objects, and those often carry page data.
    await recordError('test.stage', `raw throw with ${AWS_KEY}`);

    const logged = await getErrors();
    expect(logged[0]?.message).not.toContain(AWS_KEY);
  });
});

describe('recording', () => {
  it('keeps what a bug report needs', async () => {
    await recordError('ui.panel', new TypeError('cannot read x of undefined'));

    const [entry] = await getErrors();
    expect(entry?.where).toBe('ui.panel');
    expect(entry?.message).toContain('TypeError');
    expect(entry?.message).toContain('cannot read x of undefined');
    expect(entry?.at).toBeGreaterThan(0);
  });

  it('puts the newest first', async () => {
    await recordError('first', new Error('one'));
    await recordError('second', new Error('two'));

    const logged = await getErrors();
    expect(logged[0]?.where).toBe('second');
  });

  it('is bounded', async () => {
    // A log that grows without limit is a liability in a product whose pitch
    // is that it does not accumulate your data.
    for (let i = 0; i < MAX_ERRORS + 10; i += 1) {
      await recordError('stage', new Error(`error ${i}`));
    }

    expect(await getErrors()).toHaveLength(MAX_ERRORS);
  });

  it('can be emptied', async () => {
    await recordError('stage', new Error('boom'));
    await clearErrors();

    expect(await getErrors()).toEqual([]);
  });
});

describe('never becoming the fault', () => {
  it('does not throw when storage is unavailable', async () => {
    // Called from catch blocks whose job is to keep the extension out of the
    // way. A logger that can break the thing it is watching is worse than none.
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('no storage'));

    await expect(recordError('stage', new Error('boom'))).resolves.toBeUndefined();
  });

  it('returns an empty log rather than throwing when storage fails', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('no storage'));

    await expect(getErrors()).resolves.toEqual([]);
  });

  it('survives a stored value of the wrong shape', async () => {
    await fakeBrowser.storage.local.set({ 'apa:errors': 'not an array' });

    expect(await getErrors()).toEqual([]);
  });
});

describe('formatting for a bug report', () => {
  it('produces something paste-able', async () => {
    await recordError('ui.panel', new Error('boom'));

    const report = formatForReport(await getErrors());
    expect(report).toContain('ui.panel');
    expect(report).toContain('boom');
  });

  it('says so when there is nothing to report', () => {
    expect(formatForReport([])).toBe('No errors recorded.');
  });
});
