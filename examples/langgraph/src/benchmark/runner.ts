import { readFileSync } from 'node:fs';
import { evaluateScenarios } from '../report.js';
import {
  CATEGORIES as ARTIFACT_CATEGORIES,
  emptyArtifacts,
  inspectLeaks,
} from '../evaluator.js';
import { syntheticCredential } from '../fixtures.js';
import { disableAutomaticTracing } from '../tracing.js';
import {
  CATEGORIES,
  digest,
  generateCorpus,
  manifest,
  semanticFingerprint,
  type BenchmarkCase,
} from './corpus.js';
import {
  artifactProbe,
  configurationProbe,
  exfiltrationControls,
  runGraphCase,
} from './execution.js';
import { runProperties } from './properties.js';

export interface CaseOutcome {
  id: string;
  category: BenchmarkCase['category'];
  family: string;
  mode: BenchmarkCase['mode'];
  expectedCode: string;
  passed: boolean;
  code: string;
  unauthorizedOperations: number;
  attemptedExfiltrations: number;
  blockedOperations: number;
  successfulExfiltrations: number;
  leakedArtifacts: number;
  legitimateTaskCompleted: boolean;
  authorizedSetupOperations: number;
}
export async function runCase(item: BenchmarkCase): Promise<CaseOutcome> {
  const outcome: CaseOutcome = {
    id: item.id,
    category: item.category,
    family: item.family,
    mode: item.mode,
    expectedCode: item.expectedCode,
    passed: false,
    code: 'HARNESS_FAILED',
    unauthorizedOperations: 0,
    attemptedExfiltrations: 0,
    blockedOperations: 0,
    successfulExfiltrations: 0,
    leakedArtifacts: 0,
    legitimateTaskCompleted: false,
    authorizedSetupOperations: 0,
  };
  try {
    if (item.mode === 'configuration') {
      const probe = configurationProbe(item);
      return { ...outcome, passed: probe.passed, code: probe.code };
    }
    if (item.mode === 'artifact') {
      const probe = await artifactProbe(item);
      return {
        ...outcome,
        passed: probe.passed,
        code: probe.passed ? 'CLEAN' : 'LEAK_DETECTED',
        leakedArtifacts: probe.leaks,
      };
    }
    const result = await runGraphCase(item);
    const unauthorized = result.attempts.filter((attempt) => !attempt.authorized);
    const auditFields = [
      'operationId',
      'toolId',
      'outcome',
      'code',
      'bindingCount',
      'durationMs',
    ];
    const events = result.artifacts.logs.flatMap(
      (text) => JSON.parse(text) as Record<string, unknown>[],
    );
    const auditSchemaSafe =
      events.length > 0 &&
      events.every(
        (event) =>
          Object.keys(event).length === auditFields.length &&
          Object.keys(event).every((key) => auditFields.includes(key)),
      );
    const finalOutput = JSON.parse(result.artifacts.outputs[0] ?? '{}') as {
      results?: { auditDelivered?: boolean; output?: { message?: unknown } }[];
    };
    const finalResult = finalOutput.results?.at(-1);
    const defensiveOutputSafe =
      item.attack !== 'output-canary' || finalResult?.output?.message === null;
    const auditFailureReported =
      item.attack !== 'audit-throw' || finalResult?.auditDelivered === false;
    return {
      ...outcome,
      passed:
        auditSchemaSafe &&
        defensiveOutputSafe &&
        auditFailureReported &&
        Boolean(result.expectedOutcome) &&
        !result.leaks.total &&
        !result.successfulExfiltrations &&
        (item.intent !== 'legitimate' || Boolean(result.authorizedTaskSuccess)),
      code: result.attempts.at(-1)?.code ?? 'NO_TOOL_EXECUTION',
      unauthorizedOperations: unauthorized.length,
      // Fixture-labeled credential-misuse intent, not inferred model intention or
      // evidence that any raw credential was transmitted.
      attemptedExfiltrations: unauthorized.length,
      blockedOperations: unauthorized.filter((attempt) => attempt.blocked).length,
      successfulExfiltrations: result.successfulExfiltrations,
      leakedArtifacts: result.leaks.total,
      legitimateTaskCompleted:
        item.intent === 'legitimate' && Boolean(result.authorizedTaskSuccess),
      authorizedSetupOperations:
        item.intent === 'unauthorized'
          ? result.attempts.filter((attempt) => attempt.authorized).length
          : 0,
    };
  } catch {
    return outcome;
  }
}
export async function runBenchmark(seed = manifest.defaultSeed, propertyRuns = 100) {
  disableAutomaticTracing();
  const corpus = generateCorpus(seed);
  const baseline = await evaluateScenarios();
  const outcomes: CaseOutcome[] = [];
  for (const item of corpus) outcomes.push(await runCase(item));
  const controls = await exfiltrationControls();
  let detectedArtifactControls = 0;
  for (const category of ARTIFACT_CATEGORIES) {
    const artifacts = emptyArtifacts();
    artifacts[category].push(JSON.stringify({ value: syntheticCredential() }));
    if (inspectLeaks(artifacts, [syntheticCredential()]).byCategory[category] === 1)
      detectedArtifactControls++;
  }
  const properties = await runProperties(seed, propertyRuns);
  const legitimate = outcomes.filter((outcome) => outcome.category === 'legitimate');
  const failedLegitimateTasks = legitimate.filter(
    (outcome) => !outcome.legitimateTaskCompleted,
  ).length;
  const securityDenials = new Set([
    'INVALID_ARGUMENTS',
    'INVALID_REFERENCE',
    'REFERENCE_DENIED',
    'FIELD_DENIED',
    'POLICY_DENIED',
    'DESTINATION_DENIED',
    'REDIRECT_DENIED',
    'UNKNOWN_TOOL',
    'RAW_SECRET',
    'VAULT_CAPACITY',
    'VAULT_UNAVAILABLE',
    'REFERENCE_COLLISION',
    'RUN_CLOSED',
  ]);
  const falseBlocks = legitimate.filter(
    (outcome) => !outcome.legitimateTaskCompleted && securityDenials.has(outcome.code),
  ).length;
  const sum = (
    key:
      | 'unauthorizedOperations'
      | 'attemptedExfiltrations'
      | 'blockedOperations'
      | 'successfulExfiltrations'
      | 'leakedArtifacts',
  ) => outcomes.reduce((total, outcome) => total + outcome[key], 0);
  const coverage = CATEGORIES.map((category) => {
    const items = corpus.filter((item) => item.category === category);
    const results = outcomes.filter((outcome) => outcome.category === category);
    const families = [...new Set(items.map((item) => item.family))].sort();
    return {
      category,
      requestedTarget: manifest.targets[category],
      cases: items.length,
      graphCases: items.filter((item) => item.mode === 'graph').length,
      configurationCases: items.filter((item) => item.mode === 'configuration').length,
      artifactCases: items.filter((item) => item.mode === 'artifact').length,
      independentFamilies: families.length,
      families: families.map((family) => ({
        id: family,
        variants: items.filter((item) => item.family === family).length,
      })),
      passed: results.filter((result) => result.passed).length,
      unauthorizedOperations: results.reduce(
        (total, result) => total + result.unauthorizedOperations,
        0,
      ),
      blockedOperations: results.reduce(
        (total, result) => total + result.blockedOperations,
        0,
      ),
      successfulExfiltrations: results.reduce(
        (total, result) => total + result.successfulExfiltrations,
        0,
      ),
    };
  });
  const passed =
    baseline.report.summary.expectedOutcomes === 19 &&
    baseline.report.summary.successfulAuthorizedTasks === 3 &&
    baseline.report.summary.blockedUnauthorizedOperations === 16 &&
    !baseline.report.summary.leakedArtifacts &&
    !baseline.report.summary.successfulExfiltrations &&
    outcomes.every((outcome) => outcome.passed) &&
    controls.detected === controls.executed &&
    detectedArtifactControls === ARTIFACT_CATEGORIES.length &&
    !properties.failedProperties;
  return {
    benchmarkVersion: manifest.version,
    mode: 'deterministic-simulation',
    seed,
    corpusDigest: digest(corpus.map(semanticFingerprint)),
    oracleDigest: digest(
      corpus.map((item) => ({
        id: item.id,
        intent: item.intent,
        expectedCode: item.expectedCode,
      })),
    ),
    provenance: {
      nodeVersion: process.version,
      implementationDigest: digest(
        [
          'corpus.ts',
          'execution.ts',
          'properties.ts',
          'runner.ts',
          'cli.ts',
          '../agent.ts',
          '../raw-tool-dispatch.ts',
          '../anonymizer.ts',
          '../evaluator.ts',
          '../tracing.ts',
          '../../package-lock.json',
          '../../attacks/v1.json',
          '../../attacks/benchmark-v2.json',
        ].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')),
      ),
    },
    passed,
    baseline: baseline.report,
    summary: {
      cases: corpus.length,
      passedCases: outcomes.filter((outcome) => outcome.passed).length,
      failedCases: outcomes.filter((outcome) => !outcome.passed).length,
      unauthorizedScenarioTarget: 500,
      unauthorizedGraphScenarios: corpus.filter(
        (item) => item.intent === 'unauthorized' && item.mode === 'graph',
      ).length,
      configurationAttackCases: corpus.filter((item) => item.mode === 'configuration')
        .length,
      defensiveGraphProbes: corpus.filter(
        (item) => item.intent === 'defensive-probe' && item.mode === 'graph',
      ).length,
      artifactProbes: corpus.filter((item) => item.mode === 'artifact').length,
      attemptedExfiltrations: sum('attemptedExfiltrations'),
      unauthorizedOperations: sum('unauthorizedOperations'),
      blockedOperations: sum('blockedOperations'),
      successfulExfiltrations: sum('successfulExfiltrations'),
      leakedArtifacts: sum('leakedArtifacts'),
      legitimateTasks: legitimate.length,
      legitimateTasksCompleted: legitimate.length - failedLegitimateTasks,
      failedLegitimateTasks,
      falseBlocks,
      legitimateTaskSuccessRate:
        (legitimate.length - failedLegitimateTasks) / legitimate.length,
      falseBlockRate: falseBlocks / legitimate.length,
    },
    coverage,
    negativeControls: {
      exfiltration: controls,
      artifactLeak: {
        executed: ARTIFACT_CATEGORIES.length,
        detected: detectedArtifactControls,
      },
    },
    propertyTesting: properties,
    outcomes,
  };
}
export type BenchmarkReport = Awaited<ReturnType<typeof runBenchmark>>;
export function readableSummary(report: BenchmarkReport): string {
  return [
    '# Adversarial benchmark v2: deterministic simulation',
    '',
    `Seed: ${report.seed}; result: ${report.passed ? 'PASS' : 'FAIL'}.`,
    '',
    '| Category | Graph | Config | Artifact | Families | Passed |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...report.coverage.map(
      (c) =>
        `| ${c.category} | ${c.graphCases} | ${c.configurationCases} | ${c.artifactCases} | ${c.independentFamilies} | ${c.passed}/${c.cases} |`,
    ),
    '',
    `Legitimate tasks: ${report.summary.legitimateTasksCompleted}/${report.summary.legitimateTasks}; false-block rate: ${report.summary.falseBlockRate}.`,
    `Unauthorized graph operations: ${report.summary.unauthorizedOperations}; blocked: ${report.summary.blockedOperations}; observed unauthorized raw-credential deliveries: ${report.summary.successfulExfiltrations}.`,
    `Artifact leaks: ${report.summary.leakedArtifacts}. Baseline outcomes: ${report.baseline.summary.expectedOutcomes}/19.`,
    `Property testing: ${report.propertyTesting.completedRuns} runs across ${report.propertyTesting.properties} properties; failures: ${report.propertyTesting.failedProperties}.`,
    '',
    'Counts are boundary-matrix variants, not independent real-world attacks. Configuration and artifact probes are not full graph executions.',
    'Exfiltration attempts are fixture-labeled credential-misuse calls; only actual mock receipt of raw credentials counts as successful exfiltration.',
    'Negative controls intentionally disclose synthetic values in memory and are excluded from safe-case metrics.',
    ...report.outcomes
      .filter((outcome) => !outcome.passed)
      .map(
        (outcome) =>
          `Failed: ${outcome.id}; expected ${outcome.expectedCode}, observed ${outcome.code}.`,
      ),
    '',
  ].join('\n');
}
