import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detect } from '../lib/detector/engine';
import { ALL_RULES } from '../lib/detector/rules';
import type { Rule } from '../lib/detector/types';

/**
 * The performance budget.
 *
 * The PRD's requirement is one number — detection must stay under 50ms on a
 * 10KB draft — but the reason behind it is what the rest of this file is for.
 * The extension runs on every keystroke in someone else's page. A tool that
 * makes ChatGPT feel slow gets uninstalled long before it ever catches
 * anything, and the user is then protected by nothing.
 *
 * So the budgets here are deliberately generous against measured reality and
 * tight against catastrophe. They are not tuned to "just passing"; they exist
 * to catch a rule with runaway backtracking before it ships, and they are
 * checked with a meta-test that proves the gate can actually fail.
 */

/** Realistic mixed content — prose, code, ids — with one real secret at the end. */
function buildInput(bytes: number): string {
  const filler = [
    'Can you help me refactor this function to be more readable?',
    "import { defineConfig } from 'wxt';",
    '  at Object.<anonymous> (/app/src/index.ts:42:15)',
    'reverted in 9f2b1c4d8e6a0b3c5d7e9f1a2b4c6d8e0f2a4b6c',
    'request id 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed',
    'palette: #1a1a1a #f5f5f5 #3b82f6 #ef4444',
    'see https://docs.example.com/api/v2/reference for details',
    'react@19.2.4, typescript@5.9.3, vitest@4.1.10',
  ].join('\n');

  const repeated = filler.repeat(Math.ceil(bytes / filler.length) + 1);
  return `${repeated.slice(0, bytes)}\nAWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7`;
}

/** Median of several runs, after a warm-up. Medians resist a noisy CI box. */
function timeScan(input: string, rules: readonly Rule[] = ALL_RULES, runs = 5): number {
  detect(input, {}, rules);

  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    detect(input, {}, rules);
    samples.push(performance.now() - started);
  }

  return samples.sort((a, b) => a - b)[Math.floor(runs / 2)]!;
}

const KB = 1024;

/**
 * Budgets per input size.
 *
 * The 10KB figure is the PRD's. The others are scaled from it with slack for a
 * slow CI runner, and their real job is shape: if 1MB is not roughly 100× 10KB,
 * something in the rule set is superlinear and this is where that shows up.
 */
const BUDGETS = [
  { name: '1KB', bytes: KB, budgetMs: 20 },
  { name: '10KB', bytes: 10 * KB, budgetMs: 50 },
  { name: '100KB', bytes: 100 * KB, budgetMs: 500 },
  { name: '1MB', bytes: 1024 * KB, budgetMs: 3000 },
] as const;

describe('detection stays inside its budget', () => {
  const measured = new Map<string, number>();

  it.each(BUDGETS)('scans $name within $budgetMs ms', ({ name, bytes, budgetMs }) => {
    const input = buildInput(bytes);
    const elapsed = timeScan(input);
    measured.set(name, elapsed);

    // Printed so a regression is visible as a trend, not only as a pass/fail.
    console.log(`  ${name.padStart(5)}: ${elapsed.toFixed(2)}ms (budget ${budgetMs}ms)`);

    expect(elapsed).toBeLessThan(budgetMs);
  });

  it('still finds the secret at the far end of a 1MB input', () => {
    /*
     * The check that stops "fast" from being achieved by giving up. Any future
     * optimisation that caps or samples the input has to keep this passing, and
     * the secret is deliberately the very last thing in the string.
     */
    const findings = detect(buildInput(1024 * KB), {}, ALL_RULES);

    expect(findings.some((f) => f.ruleId.startsWith('aws'))).toBe(true);
  });

  it('scales roughly linearly, not quadratically', () => {
    // The guard that actually matters. Catastrophic backtracking does not show
    // up at 10KB; it shows up as a tab that never comes back.
    const small = timeScan(buildInput(10 * KB));
    const large = timeScan(buildInput(100 * KB));

    // 10× the input should be well under 40× the time. Generous, because at
    // these speeds timer granularity is a real share of the measurement.
    expect(large).toBeLessThan(Math.max(small * 40, 50));
  });
});

/**
 * The pathological paste.
 *
 * "1MB of prose" is not the worst case — detection is linear and shrugs at it.
 * The worst case is 1MB that is *entirely secrets*, because then every stage
 * after detection scales with the finding count rather than the byte count:
 * redaction builds a new string per placeholder, and the approval modal renders
 * a row per distinct value.
 *
 * That is where a freeze would come from, and it is worth knowing which stage
 * before reaching for a fix.
 */
describe('a paste that is nothing but secrets', () => {
  /** ~200k of distinct AWS keys — about 8,000 separate findings. */
  function buildSecretStorm(count: number): string {
    const lines: string[] = [];
    for (let i = 0; i < count; i += 1) {
      // Distinct keys, so nothing dedupes them away.
      const suffix = i.toString(36).toUpperCase().padStart(6, 'X');
      lines.push(`AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYN${suffix}`);
    }
    return lines.join('\n');
  }

  it('detects thousands of secrets without stalling', () => {
    const input = buildSecretStorm(8_000);

    const started = performance.now();
    const findings = detect(input, {}, ALL_RULES);
    const elapsed = performance.now() - started;

    console.log(
      `  ${findings.length} findings in ${(input.length / KB).toFixed(0)}kB: ${elapsed.toFixed(1)}ms`,
    );

    expect(findings.length).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(1000);
  });

  it('redacts thousands of secrets without stalling', async () => {
    // The stage that scales with finding count rather than input size.
    const { redact } = await import('../lib/detector/engine');
    const input = buildSecretStorm(8_000);
    const findings = detect(input, {}, ALL_RULES);

    const started = performance.now();
    const { text } = redact(input, findings);
    const elapsed = performance.now() - started;

    console.log(`  redacting ${findings.length} findings: ${elapsed.toFixed(1)}ms`);

    expect(text).not.toContain('AKIA3TZ2MRSYN');

    /*
     * Budget set deliberately tight, because this number is a regression
     * tripwire rather than a limit.
     *
     * It measured 1,089ms when this test was first written — the redaction
     * path rebuilt the whole string once per finding, and re-ran on every
     * checkbox toggle in the approval modal. One pass and a neighbour-only
     * overlap check took it to ~7ms. Anything approaching three figures here
     * means that regressed.
     */
    expect(elapsed).toBeLessThan(150);
  });
});

describe('typing on a long draft', () => {
  it('costs less per keystroke than a frame', () => {
    /*
     * The live scanner debounces at 250ms and skips unchanged text, so this is
     * not run per keystroke in practice. It is measured per keystroke anyway,
     * because the debounce is a mitigation and this is the underlying cost —
     * if the cost itself were over a frame, the mitigation would only be
     * hiding it behind a delay the user still feels as lag.
     */
    const draft = buildInput(20 * KB);
    const samples: number[] = [];

    // Ten "keystrokes" on an already-long draft, each changing the text so the
    // scanner's unchanged-text short circuit cannot flatter the numbers.
    for (let i = 0; i < 10; i += 1) {
      const typed = `${draft} and one more thing ${i}`;
      const started = performance.now();
      detect(typed, {}, ALL_RULES);
      samples.push(performance.now() - started);
    }

    const worst = Math.max(...samples);
    console.log(`  worst keystroke on a 20KB draft: ${worst.toFixed(2)}ms`);

    // One 60fps frame is 16.7ms. Staying under it means the scan cannot drop
    // a frame even if it ran on every keystroke with no debounce at all.
    expect(worst).toBeLessThan(16.7);
  });
});

describe('the budget gate can actually fail', () => {
  it('rejects a rule with catastrophic backtracking', () => {
    /*
     * A meta-test. A performance gate nobody has watched fail is a gate nobody
     * knows is wired up — this proves the measurement responds to a genuinely
     * slow rule rather than passing because the harness is inert.
     *
     * The pattern is the classic nested-quantifier bomb. On a run of `a` with
     * no trailing `!`, the engine explores exponentially many splits.
     *
     * The run length is 22 rather than a rounder number because the cost is
     * 2^n: the first version used 30 and took **56 seconds**, which is itself
     * the finding — a rule like this does not make the extension slow, it makes
     * the tab never come back. 22 is about a fifth of a second, which proves
     * the same point inside a test timeout.
     */
    const evil: Rule = {
      id: 'test.catastrophic',
      label: 'Deliberately slow rule',
      tier: 'low',
      pattern: /(?:a+)+!/g,
      token: 'SLOW',
    };

    const input = `${'a'.repeat(22)}${'b'}`;

    const started = performance.now();
    detect(input, {}, [evil]);
    const elapsed = performance.now() - started;

    console.log(`  catastrophic rule on 23 chars: ${elapsed.toFixed(1)}ms`);

    // The point is not the exact number. It is that this tiny input costs
    // vastly more than a 10KB scan with the entire real rule set — so the
    // budgets above would catch such a rule long before it reached a user.
    expect(elapsed).toBeGreaterThan(timeScan(buildInput(10 * KB)));
  });

  it('confirms the real rule set has no such pattern', () => {
    // The input that costs the evil rule a fifth of a second, and a 30-char
    // version of it that cost 56 seconds. The real rules shrug at both.
    for (const length of [22, 30, 40]) {
      const started = performance.now();
      detect(`${'a'.repeat(length)}b`, {}, ALL_RULES);
      expect(performance.now() - started).toBeLessThan(20);
    }
  });
});

/**
 * Bundle size.
 *
 * The content script is injected into someone else's page on every load, so
 * its size is a cost the user pays whether or not they ever trigger anything.
 * The budget is held a little above the current figure — close enough that a
 * careless dependency trips it, loose enough that ordinary feature work does
 * not.
 *
 * Reads the built output, so it needs `npm run build`. Skips rather than fails
 * without it, matching test/manifest.test.ts — a fresh checkout running
 * `npm test` should not be blocked by a missing build.
 */
const CONTENT_SCRIPT = resolve(__dirname, '../.output/chrome-mv3/content-scripts/content.js');

function sizeOf(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

const contentSize = sizeOf(CONTENT_SCRIPT);

describe.skipIf(contentSize === null)('bundle size', () => {
  /** ADR-006 moved React to Preact and took the build from 426 kB to ~104 kB. */
  const BUDGET_BYTES = 150 * KB;

  it('keeps the content script under budget', () => {
    console.log(
      `  content script: ${(contentSize! / KB).toFixed(1)} kB (budget ${BUDGET_BYTES / KB} kB)`,
    );

    expect(contentSize!).toBeLessThan(BUDGET_BYTES);
  });

  it('has not quietly acquired a bundler-visible network client', () => {
    /*
     * Overlaps test/no-network.test.ts on purpose, from the other direction:
     * that one asserts the absence of transport, this one would notice the
     * size jump a fetch polyfill or HTTP client brings with it.
     */
    const source = readFileSync(CONTENT_SCRIPT, 'utf8');

    expect(source).not.toMatch(/XMLHttpRequest|new WebSocket|EventSource/);
  });
});
