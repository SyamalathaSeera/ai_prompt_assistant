import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateRefinement } from './evaluate';
import { cleanResponse, type RefinementStyle } from './prompt';
import { REFINE_TIMEOUT_MS } from './index';

/**
 * A real run against the real model, recorded.
 *
 * Twenty-one refinements through Chrome's on-device Prompt API, using the
 * prompt this code actually builds, over the drafts the pipeline would actually
 * send. Recorded rather than re-run: CI has no model, and a test that silently
 * skipped would be worth nothing.
 *
 * It is a sample of one machine on one day, and it is the only thing here that
 * is not our own writing. The corpus in fixtures.ts measures the gate against
 * output we invented; this measures it against output we did not.
 */

interface Run {
  id: string;
  style: RefinementStyle;
  ms: number;
  draft: string;
  output: string;
}

const recording = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../test/refine-corpus/on-device-2026-08-13.json'),
    'utf8',
  ),
) as { recordedAt: string; device: string; runs: Run[]; holdout: Run[] };

const runs = recording.runs;
const times = runs.map((r) => r.ms).sort((a, b) => a - b);
const percentile = (p: number) => times[Math.min(times.length - 1, Math.round((times.length - 1) * p))]!;

const graded = runs.map((run) => ({
  ...run,
  report: evaluateRefinement(run.draft, cleanResponse(run.output), run.style),
}));

describe('latency', () => {
  it('is what the budget was set from', () => {
    // Recorded so the next person can see where 20s came from rather than
    // finding a number with no argument behind it.
    expect({
      n: times.length,
      medianMs: percentile(0.5),
      p90Ms: percentile(0.9),
      slowestMs: times[times.length - 1],
    }).toEqual({ n: 21, medianMs: 5718, p90Ms: 10110, slowestMs: 10562 });
  });

  it('fits inside the timeout with room to spare', () => {
    // The original 8s budget would have killed five of these twenty-one and
    // reported them to the user as failures.
    expect(REFINE_TIMEOUT_MS).toBeGreaterThan(times[times.length - 1]! * 1.5);
  });

  it('is slow enough that waiting has to be interruptible', () => {
    // Ten seconds is far too long to face a control that ignores you, which is
    // why the button cancels while it works rather than sitting disabled.
    expect(percentile(0.9)).toBeGreaterThan(5_000);
  });
});

describe('the gate against output it did not write', () => {
  it('accepts most of what the model actually produced', () => {
    // A gate that refused most real output would be a feature that never works.
    const accepted = graded.filter((g) => g.report.ok).length;
    expect(accepted / graded.length).toBeGreaterThanOrEqual(0.75);
  });

  it('still refuses something', () => {
    // And one that accepted everything would not be a gate.
    expect(graded.some((g) => !g.report.ok)).toBe(true);
  });

  it('invents nothing on any real output', () => {
    // The instruction's hardest rule, measured rather than hoped for.
    for (const g of graded) {
      expect(g.report.invented, `${g.id}/${g.style}`).toEqual([]);
    }
  });

  it('carries every placeholder through untouched', () => {
    // The claim the whole ordering rests on: a redacted draft comes back
    // redacted, with the token intact, or it is refused.
    const withPlaceholder = runs.filter((r) => r.draft.includes('[REDACTED'));
    expect(withPlaceholder.length).toBeGreaterThan(0);

    for (const run of withPlaceholder) {
      const expected = /\[[A-Z][A-Z0-9_]*\]/.exec(run.draft)![0];
      expect(run.output, `${run.id}/${run.style}`).toContain(expected);
    }
  });

  it('leaves no preamble in anything it accepted', () => {
    for (const g of graded.filter((x) => x.report.ok)) {
      expect(g.report.problems, `${g.id}/${g.style}`).not.toContain('preamble');
    }
  });

  it('names why it refused each one it refused', () => {
    for (const g of graded.filter((x) => !x.report.ok)) {
      expect(g.report.problems.length, `${g.id}/${g.style}`).toBeGreaterThan(0);
    }
  });
});

describe('the holdout', () => {
  /**
   * Drafts written after the gate was finished.
   *
   * The thresholds above were tuned while looking at the first batch, which
   * makes that batch a poor witness for whether they generalise. These six were
   * written afterwards and run once; nothing was adjusted in response.
   */
  const holdout = recording.holdout.map((run) => ({
    ...run,
    report: evaluateRefinement(run.draft, cleanResponse(run.output), run.style),
  }));

  it('refuses none of it', () => {
    const refused = holdout.filter((h) => !h.report.ok);
    expect(refused.map((h) => `${h.id}: ${h.report.problems.join(',')}`)).toEqual([]);
  });

  it('invents nothing in it either', () => {
    for (const h of holdout) {
      expect(h.report.invented, `${h.id}/${h.style}`).toEqual([]);
    }
  });

  it('records a tail far worse than the median', () => {
    // One call took 50 seconds. It is confounded — the tooling lost its
    // connection to the page mid-call — but it is left in rather than tidied
    // away, because a tail like that is the case the timeout and the cancel
    // button exist for, and a corpus with the inconvenient sample removed
    // would be a corpus that agrees with us by construction.
    const slowest = Math.max(...recording.holdout.map((h) => h.ms));
    expect(slowest).toBeGreaterThan(REFINE_TIMEOUT_MS);
  });
});

describe('what the recording changed', () => {
  it('accepts a heavy compression of a padded draft', () => {
    /*
     * The measurement that moved a threshold.
     *
     * Forty words of politeness became "Explain caching concepts at a high
     * level" — a length ratio of 0.16, and precisely the feature working. The
     * first gate refused it, along with three others like it, because it had a
     * proportional floor. The floor is gone; what a rewrite dropped is caught
     * by intent retention, not by how much shorter it got.
     */
    const compressed = graded.find(
      (g) => g.id === 'padded-request' && g.style === 'concise',
    )!;

    expect(compressed.report.lengthRatio).toBeLessThan(0.3);
    expect(compressed.report.ok).toBe(true);
  });
});
