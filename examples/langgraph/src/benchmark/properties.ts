import fc from 'fast-check';
import {
  createAgentSecurity,
  type FixedServiceTool,
  type BindingPolicy,
} from '@ai-prompt-assistant/agent-security';

export const PROPERTY_IDS = ['policy', 'placeholder', 'scope', 'destination'] as const;
export type PropertyId = (typeof PROPERTY_IDS)[number];
function fixture() {
  let receipts = 0;
  const origin = 'https://service.example.test';
  const tool: FixedServiceTool = {
    id: 'records.read',
    origin,
    input: { credential: { type: 'string', secret: true } },
    output: { message: { type: 'string' } },
    async invoke(request) {
      if (request.arguments.credential === 'synthetic-property-canary') receipts++;
      return {
        status: 200,
        origin: request.origin,
        redirected: false,
        data: { message: 'success' },
      };
    },
  };
  return { tool, origin, receipts: () => receipts };
}
const scope = { tenantId: 'tenant-a', principalId: 'principal-a', runId: 'run-a' };
export async function checkProperty(id: PropertyId, seed: number, numRuns: number) {
  const property = fc.asyncProperty(
    fc.record({
      mask: fc.integer({ min: 1, max: 7 }),
      value: fc.integer({ min: 1, max: 1000000 }),
      allow: fc.boolean(),
      variant: fc.integer({ min: 0, max: 5 }),
    }),
    async (input) => {
      const f = fixture();
      if (id === 'destination') {
        const origin = `https://s${input.value.toString(36)}.example.test`;
        const invalid = [
          origin + '/path',
          origin + ':443',
          origin + '@attacker.invalid',
          origin.replace('https:', 'http:'),
          origin + '?redirect=attacker.invalid',
          origin + '.',
        ][input.variant]!;
        let accepted = false;
        try {
          createAgentSecurity({
            tools: [{ ...f.tool, origin: input.allow ? origin : invalid }],
          });
          accepted = true;
        } catch {
          /* static boolean oracle only */
        }
        return accepted === input.allow;
      }
      const core = createAgentSecurity({ tools: [f.tool] });
      const owner = core.run(scope);
      const policy: BindingPolicy = {
        grants:
          input.allow || id !== 'policy'
            ? [{ toolId: f.tool.id, origin: f.origin, fields: ['credential'] }]
            : [],
      };
      const reference = owner.bind('synthetic-property-canary', policy);
      let other: ReturnType<typeof core.run> | undefined;
      try {
        if (id === 'policy') {
          // Mutating trusted caller-owned objects after binding/registration must
          // not expand grants or replace destination/schema snapshots.
          (policy.grants as unknown[]).splice(0, policy.grants.length, {
            toolId: f.tool.id,
            origin: f.origin,
            fields: ['credential'],
          });
          (f.tool as { origin: string }).origin = 'https://attacker.invalid';
          const result = await owner.execute('records.read', { credential: reference });
          return result.ok === input.allow && f.receipts() === (input.allow ? 1 : 0);
        }
        if (id === 'placeholder') {
          const second = owner.bind(`synthetic-other-canary-${input.value}`, policy);
          const firstResult = await owner.execute('records.read', {
            credential: reference,
          });
          const repeatedResult = await owner.execute('records.read', {
            credential: reference,
          });
          const secondResult = await owner.execute('records.read', {
            credential: second,
          });
          return (
            reference !== second &&
            /^\[\[APA_SECRET_[a-f0-9]{64}\]\]$/.test(reference) &&
            /^\[\[APA_SECRET_[a-f0-9]{64}\]\]$/.test(second) &&
            firstResult.ok &&
            repeatedResult.ok &&
            secondResult.ok &&
            f.receipts() === 2
          );
        }
        other = core.run({
          tenantId: scope.tenantId + (input.mask & 1 ? '-other' : ''),
          principalId: scope.principalId + (input.mask & 2 ? '-other' : ''),
          runId: scope.runId + (input.mask & 4 ? '-other' : ''),
        });
        const result = await other.execute('records.read', { credential: reference });
        return !result.ok && result.code === 'REFERENCE_DENIED' && f.receipts() === 0;
      } finally {
        other?.dispose();
        owner.dispose();
      }
    },
  );
  // Never expose fast-check counterexamples, thrown exceptions or payloads. Keep
  // seed/run counts so failures can be reproduced in a local synthetic fixture.
  const details = await fc.check(property, { seed, numRuns, endOnFailure: true });
  return {
    id,
    seed,
    requestedRuns: numRuns,
    completedRuns: details.numRuns,
    failed: details.failed,
    skipped: details.numSkips,
    shrinks: details.numShrinks,
  };
}
export async function runProperties(seed: number, numRuns = 100) {
  const results = [];
  for (const [index, id] of PROPERTY_IDS.entries())
    results.push(await checkProperty(id, seed + index, numRuns));
  return {
    framework: 'fast-check',
    properties: results.length,
    completedRuns: results.reduce((sum, result) => sum + result.completedRuns, 0),
    failedProperties: results.filter((result) => result.failed).length,
    results,
  };
}
