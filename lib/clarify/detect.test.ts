import { describe, expect, it } from 'vitest';
import { LONG_PROMPT_WORDS, needsClarification } from './index';

const withHistory = { priorTurns: 4 };
const freshChat = { priorTurns: 0 };

/**
 * The three cases the milestone specifies, first. Everything after them is
 * about the gate staying quiet.
 */
describe('the clarification gate', () => {
  it('fires on a vague draft in a conversation with history', () => {
    const check = needsClarification('add this over there and make it cleaner', withHistory);

    expect(check.needed).toBe(true);
    if (check.needed) expect(check.references.length).toBeGreaterThan(0);
  });

  it('stays silent on a fresh chat with no history', () => {
    // Nothing above to resolve against. The same draft that fires with
    // history must be silent without it.
    const check = needsClarification('add this over there and make it cleaner', freshChat);

    expect(check.needed).toBe(false);
    if (!check.needed) expect(check.reason).toBe('no-history');
  });

  it('stays silent on a specific, self-contained prompt', () => {
    const draft =
      'In `src/auth/session.ts`, change validateToken() so that an expired ' +
      'token returns a 401 with the body "token expired" instead of throwing. ' +
      'Keep the existing refresh path untouched, leave the 30s timeout alone, ' +
      'and update the tests in session.test.ts to cover this.';

    // Two independent gates would each catch this one — the antecedent check
    // resolves the trailing "this" against everything already named, and the
    // draft is long and specific besides. Silence is the assertion; which gate
    // got there first is an implementation detail.
    expect(needsClarification(draft, withHistory).needed).toBe(false);
  });
});

describe('reasons for staying quiet', () => {
  it('reports empty drafts as empty', () => {
    for (const draft of ['', '   ', '\n\t ']) {
      const check = needsClarification(draft, withHistory);
      expect(check.needed).toBe(false);
      if (!check.needed) expect(check.reason).toBe('empty');
    }
  });

  it('reports a draft that gestures at nothing', () => {
    const check = needsClarification(
      'Write a haiku about the sea.',
      withHistory,
    );

    expect(check.needed).toBe(false);
    if (!check.needed) expect(check.reason).toBe('no-reference');
  });

  it('checks history before scanning, so a fresh chat is always silent', () => {
    // Not an optimisation detail — it is the guarantee that the feature
    // cannot appear on the first message of a conversation.
    const check = needsClarification('like before, but shorter', freshChat);

    expect(check.needed).toBe(false);
    if (!check.needed) expect(check.reason).toBe('no-history');
  });

  it('does not fire on a long prompt that merely contains "this"', () => {
    const draft =
      'Please review the migration in `db/migrations/0042_add_index.sql` and ' +
      'tell me whether the CONCURRENTLY option is safe to use on a table with ' +
      'roughly 40000000 rows, given that writes continue during the migration ' +
      'and the replica lag budget is 500ms. Explain this in terms I can take ' +
      'to the on-call review.';

    expect(draft.trim().split(/\s+/).length).toBeGreaterThanOrEqual(LONG_PROMPT_WORDS);

    // Caught by the antecedent check rather than the length gate: by the time
    // "this" arrives the draft has named a file, a flag, and two numbers.
    const check = needsClarification(draft, withHistory);
    expect(check.needed).toBe(false);
    if (!check.needed) expect(check.reason).toBe('no-reference');
  });

  it('suppresses a prior-work phrase when the rest of the draft is specific', () => {
    /*
     * The length gate earning its place. "Like before" survives the antecedent
     * check by design — nothing in a draft can resolve it — so without this
     * gate the feature would interrupt someone who has already written four
     * lines of precise instruction and tacked a familiar phrase on the front.
     *
     * This is the restrained reading of the spec, and the one Task 4 revisits
     * against real usage. It is also the only path to `self-contained`, which
     * is why it is asserted separately rather than folded into the case above.
     */
    const draft =
      'Like before, take `src/auth/session.ts` and change validateToken() so ' +
      'an expired token returns a 401 carrying the body "token expired" rather ' +
      'than throwing, keep the refresh path exactly as it is, leave the 30s ' +
      'timeout alone, and extend session.test.ts to cover the new branch.';

    expect(draft.trim().split(/\s+/).length).toBeGreaterThanOrEqual(LONG_PROMPT_WORDS);

    const check = needsClarification(draft, withHistory);
    expect(check.needed).toBe(false);
    if (!check.needed) expect(check.reason).toBe('self-contained');
  });

  it('still offers a prior-work phrase on a short draft', () => {
    // The same phrase, without four lines of specifics behind it, is exactly
    // the case this feature exists for.
    expect(needsClarification('like before, but shorter', withHistory).needed).toBe(true);
  });

  it('still fires on a long prompt that names nothing concrete', () => {
    // Length alone is not specificity. This one rambles for fifty words and
    // still never says what "it" is.
    const draft =
      'So I was thinking about the thing we were working on and I am not ' +
      'totally sure it is going in the right direction, because when I look ' +
      'at it again it feels like it might be more complicated than it really ' +
      'needs to be, and I wonder whether we should just simplify it a lot ' +
      'before we go any further with it at all.';

    expect(draft.trim().split(/\s+/).length).toBeGreaterThanOrEqual(LONG_PROMPT_WORDS);
    expect(needsClarification(draft, withHistory).needed).toBe(true);
  });
});

describe('what the gate hands on', () => {
  it('returns references whose offsets index into the draft', () => {
    const draft = 'make it like before';
    const check = needsClarification(draft, withHistory);

    expect(check.needed).toBe(true);
    if (!check.needed) return;

    for (const ref of check.references) {
      expect(draft.slice(ref.start, ref.end)).toBe(ref.text);
    }
  });

  it('carries no model call and no I/O of its own', () => {
    /*
     * ADR-004's boundary, extended to this module. The `lib` test project runs
     * in a DOM-free node environment, so a reach for `document`, `window`, or
     * `chrome` from anything imported here fails outright rather than passing
     * quietly. This assertion documents the intent; the environment enforces it.
     */
    expect(typeof globalThis.document).toBe('undefined');
    expect(needsClarification('fix this', withHistory).needed).toBe(true);
  });
});
