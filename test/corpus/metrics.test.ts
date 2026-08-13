import { describe, expect, it } from 'vitest';
import { detect } from '../../lib/detector/engine';
import { ALL_RULES } from '../../lib/detector/rules';
import type { Finding } from '../../lib/detector/types';
import { NEGATIVE_CASES } from './negative';
import { POSITIVE_CASES } from './positive';

/**
 * Detection quality gate.
 *
 * This is the product. Everything else in the extension is delivery mechanism
 * for whatever these numbers say. The thresholds below are release criteria
 * from the PRD, enforced as a failing build rather than as an aspiration.
 *
 * Precision is held higher than recall deliberately. A missed secret costs the
 * user one leak; a false alarm interrupts them mid-task and, repeated, ends
 * with the extension uninstalled — after which it catches nothing at all.
 */

const MIN_HIGH_TIER_PRECISION = 0.98;
const MIN_HIGH_TIER_RECALL = 0.9;

/** Scans with every rule enabled — the strictest setting, not the shipped default. */
function scan(text: string): Finding[] {
  return detect(text, {}, ALL_RULES);
}

function highTier(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => f.tier === 'high');
}

interface Tally {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** Detected, but attributed to a different rule than expected. */
  misattributed: Array<{ document: string; expected: string; actual: string }>;
  missed: Array<{ document: string; ruleId: string }>;
  spurious: Array<{ document: string; ruleId: string; sample: string }>;
}

function emptyTally(): Tally {
  return {
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    misattributed: [],
    missed: [],
    spurious: [],
  };
}

/** Masked so a failure message never prints a full secret, even a synthetic one. */
function mask(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ');
  if (collapsed.length <= 12) return `${collapsed.slice(0, 3)}…`;
  return `${collapsed.slice(0, 6)}…${collapsed.slice(-4)}`;
}

function measure(): Tally {
  const tally = emptyTally();

  for (const testCase of POSITIVE_CASES) {
    const found = scan(testCase.text);
    const claimed = new Set<number>();

    for (const expected of testCase.secrets) {
      const match = found.findIndex(
        (f, i) => !claimed.has(i) && testCase.text.slice(f.start, f.end) === expected.value,
      );

      if (match === -1) {
        tally.falseNegatives += 1;
        tally.missed.push({ document: testCase.name, ruleId: expected.ruleId });
        continue;
      }

      claimed.add(match);
      tally.truePositives += 1;

      const actual = found[match]!;
      if (actual.ruleId !== expected.ruleId) {
        tally.misattributed.push({
          document: testCase.name,
          expected: expected.ruleId,
          actual: actual.ruleId,
        });
      }
    }

    // Any high-tier finding in a positive document that was not one of the
    // planted secrets is a false alarm, exactly as it would be for the user.
    highTier(found).forEach((f, i) => {
      if (claimed.has(i)) return;
      const value = testCase.text.slice(f.start, f.end);
      if (testCase.secrets.some((s) => s.value === value)) return;
      tally.falsePositives += 1;
      tally.spurious.push({
        document: testCase.name,
        ruleId: f.ruleId,
        sample: mask(value),
      });
    });
  }

  for (const testCase of NEGATIVE_CASES) {
    for (const finding of highTier(scan(testCase.text))) {
      tally.falsePositives += 1;
      tally.spurious.push({
        document: testCase.name,
        ruleId: finding.ruleId,
        sample: mask(testCase.text.slice(finding.start, finding.end)),
      });
    }
  }

  return tally;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

describe('detection quality', () => {
  const tally = measure();

  const precision = ratio(
    tally.truePositives,
    tally.truePositives + tally.falsePositives,
  );
  const recall = ratio(tally.truePositives, tally.truePositives + tally.falseNegatives);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  it('reports the current metrics', () => {
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

    const report = [
      '',
      '  Detection quality — high tier',
      '  ─────────────────────────────────────────────',
      `  documents      ${POSITIVE_CASES.length} positive, ${NEGATIVE_CASES.length} negative`,
      `  true positives ${tally.truePositives}`,
      `  false positives${String(tally.falsePositives).padStart(2)}`,
      `  false negatives${String(tally.falseNegatives).padStart(2)}`,
      '',
      `  precision      ${pct(precision)}   (gate ${pct(MIN_HIGH_TIER_PRECISION)})`,
      `  recall         ${pct(recall)}   (gate ${pct(MIN_HIGH_TIER_RECALL)})`,
      `  F1             ${pct(f1)}`,
      '',
    ];

    if (tally.spurious.length > 0) {
      report.push('  false alarms:');
      for (const s of tally.spurious) {
        report.push(`    ${s.document}: ${s.ruleId} on ${s.sample}`);
      }
      report.push('');
    }

    if (tally.missed.length > 0) {
      report.push('  missed:');
      for (const m of tally.missed) {
        report.push(`    ${m.document}: ${m.ruleId}`);
      }
      report.push('');
    }

    if (tally.misattributed.length > 0) {
      report.push('  detected but misattributed:');
      for (const m of tally.misattributed) {
        report.push(`    ${m.document}: expected ${m.expected}, got ${m.actual}`);
      }
      report.push('');
    }

    console.log(report.join('\n'));
    expect(tally.truePositives).toBeGreaterThan(0);
  });

  it(`holds high-tier precision at or above ${MIN_HIGH_TIER_PRECISION}`, () => {
    // A false alarm here is a user interrupted mid-task for nothing. Repeated,
    // it is an uninstall — after which the tool protects them from nothing.
    expect(
      precision,
      `false alarms: ${JSON.stringify(tally.spurious, null, 2)}`,
    ).toBeGreaterThanOrEqual(MIN_HIGH_TIER_PRECISION);
  });

  it(`holds high-tier recall at or above ${MIN_HIGH_TIER_RECALL}`, () => {
    expect(
      recall,
      `missed secrets: ${JSON.stringify(tally.missed, null, 2)}`,
    ).toBeGreaterThanOrEqual(MIN_HIGH_TIER_RECALL);
  });

  it('produces no high-tier finding on any negative document', () => {
    const offenders = NEGATIVE_CASES.filter((c) => highTier(scan(c.text)).length > 0).map(
      (c) => c.name,
    );
    expect(offenders).toEqual([]);
  });

  it('attributes every detected secret to the expected rule', () => {
    // Not a gate on the leak itself — the value is redacted either way — but a
    // misattribution means the user is told the wrong thing about what leaked.
    expect(tally.misattributed).toEqual([]);
  });
});

describe('performance budget', () => {
  /** ~10KB of realistic mixed content with one secret at the very end. */
  function buildLargeInput(): string {
    const filler = NEGATIVE_CASES.map((c) => c.text).join('\n\n');
    const repeated = filler.repeat(Math.ceil(10_240 / filler.length) + 1);
    return `${repeated.slice(0, 10_240)}\nAWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7`;
  }

  it('scans 10KB in under 50ms', () => {
    const input = buildLargeInput();

    // Warm up so the measurement is not dominated by first-call JIT cost.
    scan(input);

    const started = performance.now();
    const found = scan(input);
    const elapsed = performance.now() - started;

    console.log(`\n  10KB scan: ${elapsed.toFixed(1)}ms (budget 50ms)\n`);

    expect(found.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });

  it('does not degrade catastrophically on 100KB', () => {
    const input = buildLargeInput().repeat(10);

    scan(input);
    const started = performance.now();
    scan(input);
    const elapsed = performance.now() - started;

    // Roughly linear is the requirement — this is the guard against a rule
    // with catastrophic backtracking slipping in unnoticed.
    expect(elapsed).toBeLessThan(500);
  });
});
