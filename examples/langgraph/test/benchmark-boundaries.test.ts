import { describe, expect, it } from 'vitest';
import { createAgentSecurity } from '@ai-prompt-assistant/agent-security';
import { generateCorpus } from '../src/benchmark/corpus.js';
import { graphExtension } from '../src/benchmark/execution.js';
import { runScenario } from '../src/agent.js';
import { syntheticCredential } from '../src/fixtures.js';
import { benchmarkCli } from '../src/benchmark/cli.js';

// Both original strict-rejection corpus expectations remain unchanged.
describe('prototype-key normalization finding', () => {
  it.each(generateCorpus().filter((item) => item.attack === 'prototype-key'))(
    '$id direct SDK rejection and wrapper normalization',
    async (item) => {
      const extension = graphExtension(item);
      const directService = extension.service(syntheticCredential());
      const core = createAgentSecurity({ tools: directService.tools });
      const run = core.run(extension.scope);
      const reference = run.bind(syntheticCredential(), extension.policy);
      const args = extension.initialCall(reference).args;
      expect(Object.hasOwn(args, '__proto__')).toBe(true);
      const direct = await run.execute(item.config.tool, args);
      expect(direct).toMatchObject({ ok: false, code: 'INVALID_ARGUMENTS' });
      expect(directService.snapshot().deliveries.length).toBe(0);
      run.dispose();
      let adapterSawPrototype = false;
      let adapterInvocations = 0;
      const throughGraph = await runScenario(
        {
          id: item.id,
          kind: 'read',
          expectation: 'denied',
          expectedCode: 'INVALID_ARGUMENTS',
        },
        {
          ...extension,
          service(canary) {
            const service = extension.service(canary);
            return {
              ...service,
              tools: service.tools.map((tool) => ({
                ...tool,
                invoke(request) {
                  adapterInvocations++;
                  adapterSawPrototype ||= Object.hasOwn(request.arguments, '__proto__');
                  return tool.invoke(request);
                },
              })),
            };
          },
        },
      );
      expect(
        throughGraph.artifacts.toolArguments.some((text) => text.includes('__proto__')),
      ).toBe(true);
      expect(throughGraph.attempts.at(-1)?.code).toBe('INVALID_ARGUMENTS');
      expect(adapterInvocations).toBe(0);
      expect(adapterSawPrototype).toBe(false);
      expect(throughGraph.successfulExfiltrations).toBe(0);
      expect(throughGraph.expectedOutcome).toBe(true);
    },
  );
});
describe('benchmark CLI refuses unsafe or invalid options', () => {
  it.each(
    [
      ['--upload'],
      ['--seed', 'NaN'],
      ['--seed', '2147483647'],
      ['--repeat', '0'],
      ['--repeat', '6'],
      ['--property-runs', '0'],
      ['--seed', '1', '--seed', '2'],
    ].map((args) => ({ args })),
  )('rejects $args before running or uploading', async ({ args }) => {
    await expect(benchmarkCli(args)).rejects.toThrow('INVALID_BENCHMARK_OPTIONS');
  });
});
