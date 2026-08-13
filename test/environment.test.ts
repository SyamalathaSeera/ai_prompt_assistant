import { describe, expect, it } from 'vitest';

/**
 * Guardrail test for ADR-004 (detector purity).
 *
 * The detector must be a pure function of its input string: no DOM, no
 * extension APIs, no I/O. That claim is what lets the corpus suite in
 * milestone 0.0.2.0 measure precision and recall in milliseconds without a
 * browser, and what would let the same engine be reused in a CLI or CI check
 * later.
 *
 * A convention alone would erode. This asserts the `lib` project genuinely has
 * no ambient browser globals, so any accidental DOM or chrome.* usage under
 * lib/ fails loudly at test time instead of passing here and breaking in a
 * content script.
 */
describe('lib test environment', () => {
  it('has no DOM globals', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('has no extension APIs', () => {
    expect(typeof (globalThis as Record<string, unknown>).chrome).toBe('undefined');
    expect(typeof (globalThis as Record<string, unknown>).browser).toBe('undefined');
  });

  it('runs the test harness itself', () => {
    expect(1 + 1).toBe(2);
  });
});
