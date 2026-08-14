import { describe, expect, it } from 'vitest';
import { changeRatio, diffWords } from './diff';

/** Rebuilds each side from the segments, to prove nothing was lost. */
const before = (segments: ReturnType<typeof diffWords>) =>
  segments.filter((s) => s.op !== 'added').map((s) => s.text).join('');
const after = (segments: ReturnType<typeof diffWords>) =>
  segments.filter((s) => s.op !== 'removed').map((s) => s.text).join('');

describe('diffWords', () => {
  it('reports identical text as unchanged', () => {
    const segments = diffWords('same text', 'same text');
    expect(segments).toEqual([{ op: 'same', text: 'same text' }]);
  });

  it('reconstructs both inputs exactly', () => {
    // The strongest property: whatever the segmentation, no character is
    // invented or dropped. A diff that loses a word would misrepresent what
    // the user is agreeing to.
    const a = 'Please fix the login bug in the auth handler';
    const b = 'Fix the authentication bug in the login handler, with tests';

    const segments = diffWords(a, b);

    expect(before(segments)).toBe(a);
    expect(after(segments)).toBe(b);
  });

  it('marks an inserted word as added', () => {
    const segments = diffWords('fix the bug', 'fix the login bug');
    expect(segments.some((s) => s.op === 'added' && s.text.includes('login'))).toBe(true);
  });

  it('marks a deleted word as removed', () => {
    const segments = diffWords('please fix the bug', 'fix the bug');
    expect(segments.some((s) => s.op === 'removed' && s.text.includes('please'))).toBe(
      true,
    );
  });

  it('keeps unchanged words unchanged', () => {
    // If a light edit marked the whole text as rewritten, the view would be
    // useless — the user could not see what actually changed.
    const segments = diffWords('fix the login bug', 'fix the login issue');
    const unchanged = segments.filter((s) => s.op === 'same').map((s) => s.text).join('');

    expect(unchanged).toContain('fix');
    expect(unchanged).toContain('login');
  });

  it('merges adjacent segments of the same kind', () => {
    const segments = diffWords('a b c', 'x y z');
    const runs = segments.map((s) => s.op);

    // No two neighbours share an op, or rendering fragments into one span per
    // word.
    for (let i = 1; i < runs.length; i += 1) {
      expect(runs[i]).not.toBe(runs[i - 1]);
    }
  });

  it('handles empty input on either side', () => {
    expect(diffWords('', '')).toEqual([]);
    expect(after(diffWords('', 'new text'))).toBe('new text');
    expect(before(diffWords('old text', ''))).toBe('old text');
  });

  it('falls back safely on pathological input', () => {
    // Above the token cap the quadratic table costs more than the view is
    // worth. The fallback still tells the truth: everything changed.
    const huge = 'word '.repeat(3000);
    const segments = diffWords(huge, `${huge}extra`);

    expect(segments.length).toBeGreaterThan(0);
    expect(before(segments)).toBe(huge);
    expect(after(segments)).toBe(`${huge}extra`);
  });
});

describe('changeRatio', () => {
  it('is zero for identical text', () => {
    expect(changeRatio(diffWords('same', 'same'))).toBe(0);
  });

  it('is high for a full rewrite', () => {
    // Drives the "substantially rewritten, check it still says what you meant"
    // warning, which is the point at which the user should read carefully.
    expect(changeRatio(diffWords('a b c', 'x y z'))).toBeGreaterThan(0.6);
  });

  it('is low for a light edit', () => {
    const ratio = changeRatio(
      diffWords(
        'Please fix the login bug in the authentication handler today',
        'Please fix the login issue in the authentication handler today',
      ),
    );
    expect(ratio).toBeLessThan(0.4);
  });

  it('is zero for no segments', () => {
    expect(changeRatio([])).toBe(0);
  });
});
