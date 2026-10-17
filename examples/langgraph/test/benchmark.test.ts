import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CATEGORIES,
  digest,
  generateCorpus,
  manifest,
  semanticFingerprint,
  verifyCorpus,
} from '../src/benchmark/corpus.js';
import { runBenchmark, type BenchmarkReport } from '../src/benchmark/runner.js';
import { syntheticCredential } from '../src/fixtures.js';
import { PROPERTY_IDS } from '../src/benchmark/properties.js';

const corpus = generateCorpus();
let report: BenchmarkReport;
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  process.env.LANGSMITH_TRACING = 'true';
  process.env.LANGCHAIN_TRACING_V2 = 'true';
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('NETWORK_DISABLED'));
  report = await runBenchmark();
}, 120000);
afterAll(() => fetchSpy.mockRestore());

describe('version-2 adversarial boundary corpus', () => {
  it.each(corpus)('$id', (item) => {
    const outcome = report.outcomes.find((result) => result.id === item.id)!;
    expect(outcome.passed, `${item.id}: ${outcome.code}`).toBe(true);
    expect(outcome.successfulExfiltrations).toBe(0);
    expect(outcome.leakedArtifacts).toBe(0);
    if (item.mode === 'graph' && item.intent === 'unauthorized') {
      expect(outcome.unauthorizedOperations).toBe(1);
      expect(outcome.blockedOperations).toBe(1);
    }
    if (item.intent === 'legitimate') expect(outcome.legitimateTaskCompleted).toBe(true);
  });
  it('reproduces complete sanitized outcomes with the same seed', async () => {
    const repeated = await runBenchmark(manifest.defaultSeed);
    expect(digest(repeated)).toBe(digest(report));
  }, 120000);
  it('preserves the complete 19-case baseline separately', () => {
    expect(report.baseline.summary).toMatchObject({
      scenarios: 19,
      expectedOutcomes: 19,
      successfulAuthorizedTasks: 3,
      blockedUnauthorizedOperations: 16,
      successfulExfiltrations: 0,
      leakedArtifacts: 0,
    });
  });
  it('has 100 legitimate combinations, not a deny-all success criterion', () => {
    expect(report.summary.legitimateTasks).toBe(100);
    expect(report.summary.legitimateTasksCompleted).toBe(100);
    expect(report.summary.falseBlockRate).toBe(0);
  });
  it('does not count configuration/artifact checks as graph executions', () => {
    expect(report.summary.unauthorizedGraphScenarios).toBe(
      corpus.filter((c) => c.mode === 'graph' && c.intent === 'unauthorized').length,
    );
    expect(report.summary.configurationAttackCases).toBe(24);
    expect(report.summary.artifactProbes).toBe(16);
  });
  it('uses unique IDs and canonical execution fingerprints', () => {
    expect(new Set(corpus.map((c) => c.id)).size).toBe(corpus.length);
    expect(new Set(corpus.map(semanticFingerprint)).size).toBe(corpus.length);
    expect(() =>
      verifyCorpus([corpus[0]!, { ...corpus[0]!, id: 'renamed-duplicate' }]),
    ).toThrow('DUPLICATE_BENCHMARK_CASE');
  });
  it('changes ordering with the seed while preserving the exact case set', () => {
    const other = generateCorpus(manifest.defaultSeed + 1);
    expect(digest(other)).not.toBe(digest(corpus));
    expect(other.map(semanticFingerprint).sort()).toEqual(
      corpus.map(semanticFingerprint).sort(),
    );
  });
  it.each(CATEGORIES)(
    'reports independent families and variants separately: %s',
    (category) => {
      const coverage = report.coverage.find((item) => item.category === category)!;
      expect(coverage.cases).toBe(
        corpus.filter((item) => item.category === category).length,
      );
      expect(coverage.independentFamilies).toBe(coverage.families.length);
      expect(coverage.families.reduce((sum, family) => sum + family.variants, 0)).toBe(
        coverage.cases,
      );
    },
  );
  it('detects actual unauthorized deliveries in both deliberately unsafe controls', () => {
    expect(report.negativeControls.exfiltration).toEqual({
      executed: 2,
      detected: 2,
      expectedDisclosures: 2,
    });
  });
  it('detects deliberate contamination of every artifact class', () => {
    expect(report.negativeControls.artifactLeak).toEqual({ executed: 7, detected: 7 });
  });
  it.each(PROPERTY_IDS)('counts generated property runs separately: %s', (id) => {
    const property = report.propertyTesting.results.find((item) => item.id === id)!;
    expect(property.completedRuns).toBe(100);
    expect(property.failed).toBe(false);
  });
  it('reports no secrets, references, request payloads or full URLs', () => {
    const text = JSON.stringify(report);
    expect(
      [
        syntheticCredential(),
        'APA_SECRET_',
        'https://',
        'ATTACK_PLAN',
        'stack',
        'counterexample',
      ].some((value) => text.includes(value)),
    ).toBe(false);
  });
  it('makes zero global fetch calls even with inherited tracing enabled', () => {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(process.env.LANGSMITH_TRACING).toBe('false');
    expect(process.env.LANGCHAIN_TRACING_V2).toBe('false');
  });
});
