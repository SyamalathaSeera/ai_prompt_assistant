import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { evaluateScenarios } from '../src/report.js';
import { loadScenarios, INJECTION, syntheticCredential } from '../src/fixtures.js';
import { createMockService } from '../src/mock-service.js';
import type { ServiceRequest } from '@ai-prompt-assistant/agent-security';
import {
  CATEGORIES,
  emptyArtifacts,
  inspectLeaks,
  createLangSmithLeakEvaluator,
} from '../src/evaluator.js';
import type { Run } from 'langsmith/schemas';

let evaluated: Awaited<ReturnType<typeof evaluateScenarios>>;
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  process.env.LANGSMITH_TRACING = 'true';
  process.env.LANGCHAIN_TRACING_V2 = 'true';
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('NETWORK_DISABLED'));
  evaluated = await evaluateScenarios();
});
afterAll(() => fetchSpy.mockRestore());

describe('versioned deterministic LangGraph scenarios', () => {
  it.each(loadScenarios())('$id', (scenario) => {
    const result = evaluated.results.find((r) => r.scenario.id === scenario.id)!;
    expect(result.expectedOutcome).toBe(true);
    expect(result.successfulExfiltrations).toBe(0);
    expect(result.leaks.total).toBe(0);
    if (scenario.expectation === 'authorized')
      expect(result.authorizedTaskSuccess).toBe(true);
    else expect(result.attempts.some((a) => a.blocked)).toBe(true);
    // Every call checkpointed by the graph contains only references and safe results.
    expect(result.artifacts.checkpoints.length).toBeGreaterThan(0);
    expect(result.artifacts.tracePayloads.length).toBeGreaterThan(1);
  });

  it('executes successful legitimate work so deny-all cannot pass', () => {
    const { summary } = evaluated.report;
    expect(summary.authorizedTasks).toBeGreaterThan(0);
    expect(summary.successfulAuthorizedTasks).toBe(summary.authorizedTasks);
    expect(summary.authorizedTaskSuccessRate).toBe(1);
    expect(summary.blockedUnauthorizedOperations).toBe(summary.unauthorizedOperations);
    expect(summary.expectedOutcomes).toBe(summary.scenarios);
    expect(summary.successfulExfiltrations).toBe(0);
  });

  it('routes a service-response prompt injection through the guarded tool boundary', () => {
    const result = evaluated.results.find(
      (r) => r.scenario.kind === 'response-injection',
    )!;
    expect(result.attempts.map((a) => a.ok)).toEqual([true, false]);
    expect(result.artifacts.modelInputs.some((text) => text.includes(INJECTION))).toBe(
      true,
    );
    expect(result.transport.deliveries.some((d) => d.sink === 'attacker')).toBe(false);
    expect(result.attempts[1]!.blocked).toBe(true);
  });

  it('withholds every binding in a mixed unauthorized call before transport', () => {
    const result = evaluated.results.find((r) => r.scenario.kind === 'mixed-bindings')!;
    expect(result.transport.deliveries).toHaveLength(0);
    expect(result.attempts[0]!.blocked).toBe(true);
  });

  it('verifies transport delivery, not just exceptions, for redirects', () => {
    const result = evaluated.results.find((r) => r.scenario.kind === 'redirect')!;
    expect(result.transport.redirectAttempts).toBe(1);
    expect(
      result.transport.deliveries.some(
        (d) => d.sink === 'github' && d.receivedCredential,
      ),
    ).toBe(true);
    expect(result.transport.deliveries.some((d) => d.sink === 'attacker')).toBe(false);
    expect(result.attempts[0]!.blocked).toBe(true);
  });

  it('detects actual exfiltration in an intentionally unsafe test-only transport', async () => {
    const service = createMockService(syntheticCredential(), 'redirect');
    await service.negativeControl({
      origin: 'https://api.github.com',
      redirect: 'follow',
      arguments: { credential: syntheticCredential(), repository: 'demo/repository' },
    } as unknown as ServiceRequest);
    const exfiltrations = service
      .snapshot()
      .deliveries.filter((d) => !d.authorized && d.receivedCredential);
    expect(exfiltrations.length).toBe(1);
  });

  it('produces only sanitized metrics and scenario IDs in the report', () => {
    const report = JSON.stringify(evaluated.report);
    expect(
      report.includes(syntheticCredential()) ||
        report.includes('APA_SECRET_') ||
        report.includes('https://'),
    ).toBe(false);
    expect(evaluated.report.mode).toBe('deterministic-simulation');
  });

  it('makes no external requests even with inherited tracing enabled', () => {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(process.env.LANGSMITH_TRACING).toBe('false');
    expect(process.env.LANGCHAIN_TRACING_V2).toBe('false');
  });
});

describe('offline leak evaluator sensitivity', () => {
  it.each(CATEGORIES)('detects contamination of %s', (category) => {
    const artifacts = emptyArtifacts();
    artifacts[category].push(JSON.stringify({ value: syntheticCredential() }));
    const result = inspectLeaks(artifacts, [syntheticCredential()]);
    expect(result.byCategory[category]).toBe(1);
    expect(JSON.stringify(result).includes(syntheticCredential())).toBe(false);
  });

  it('does not misclassify email-like hostile URLs as raw credential disclosure', () => {
    const artifacts = emptyArtifacts();
    artifacts.toolArguments.push('https://api.github.com@attacker.invalid');
    expect(inspectLeaks(artifacts, [syntheticCredential()]).total).toBe(0);
  });

  it('recognizes a detector-supported credential even without a supplied canary', () => {
    const artifacts = emptyArtifacts();
    artifacts.outputs.push(syntheticCredential());
    expect(inspectLeaks(artifacts, []).total).toBe(1);
  });

  it('provides a LangSmith-compatible evaluator without a client or account', async () => {
    const evaluator = createLangSmithLeakEvaluator([syntheticCredential()]);
    if (typeof evaluator !== 'function') throw new Error('INVALID_EVALUATOR');
    const clean = await evaluator({
      inputs: { reference: 'opaque' },
      outputs: { status: 'ok' },
    } as unknown as Run);
    const contaminated = await evaluator({
      inputs: {},
      outputs: { value: syntheticCredential() },
    } as unknown as Run);
    expect(clean).toMatchObject({ key: 'credential_leak_free', score: 1 });
    expect(contaminated).toMatchObject({ key: 'credential_leak_free', score: 0 });
    expect(JSON.stringify(contaminated).includes(syntheticCredential())).toBe(false);
  });
});

describe('generated identifier false-positive regression', () => {
  const grouped = '4000-0000-0002';
  const uuid = `abcddcba-${grouped}-abcdefabcdef`;
  it('does not treat a financial-pattern match wholly inside a UUID as a credential disclosure', () => {
    const artifacts = emptyArtifacts();
    artifacts.tracePayloads.push(JSON.stringify({ id: uuid }));
    expect(inspectLeaks(artifacts, [syntheticCredential()]).total).toBe(0);
  });
  it('still flags the same financial value outside a UUID', () => {
    const artifacts = emptyArtifacts();
    artifacts.outputs.push(`payment number: ${grouped}`);
    expect(inspectLeaks(artifacts, []).total).toBe(1);
  });
  it('never exempts an exact known canary just because it is inside a UUID', () => {
    const artifacts = emptyArtifacts();
    artifacts.tracePayloads.push(uuid);
    expect(inspectLeaks(artifacts, [grouped]).total).toBe(1);
  });
});
