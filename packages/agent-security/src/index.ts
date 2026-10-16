import { performance } from 'node:perf_hooks';
import { detect } from '../../detector/src/index';
import { createExecutor } from './executor';
import { freezePolicy } from './policy';
import { fail, freezeSchema, httpsOrigin, ID, record, trustedScope } from './safety';
import { Vault } from './vault';
import type { AgentSecurity, CoreOptions, FixedServiceTool, SecurityRun } from './types';

export type {
  AgentSecurity,
  AuditEvent,
  BindingPolicy,
  CoreOptions,
  ExecutionResult,
  FieldSchema,
  FixedServiceTool,
  ReasonCode,
  SafeOutput,
  Scalar,
  Schema,
  Scope,
  SecurityRun,
  ServiceRequest,
  VaultLimits,
} from './types';
export { SecurityError } from './safety';

export function createAgentSecurity(options: CoreOptions): AgentSecurity {
  try {
    const config = record(options);
    if (
      !Array.isArray(config.tools) ||
      config.tools.length > 64 ||
      (config.clock !== undefined && typeof config.clock !== 'function') ||
      (config.onAudit !== undefined && typeof config.onAudit !== 'function')
    )
      fail('INVALID_CONFIG');
    const clock = options.clock ?? (() => performance.now());
    const tools = new Map<string, FixedServiceTool>();
    for (const raw of options.tools) {
      const tool = record(raw);
      if (
        typeof tool.id !== 'string' ||
        !ID.test(tool.id) ||
        tools.has(tool.id) ||
        typeof tool.invoke !== 'function'
      )
        fail('INVALID_CONFIG');
      tools.set(
        tool.id,
        Object.freeze({
          id: tool.id,
          origin: httpsOrigin(tool.origin),
          input: freezeSchema(tool.input as FixedServiceTool['input']),
          output: freezeSchema(tool.output as FixedServiceTool['output'], true),
          invoke: tool.invoke as FixedServiceTool['invoke'],
        }),
      );
    }
    const vault = new Vault(options.vault ? record(options.vault) : {}, clock);
    // Capture trusted callbacks; later mutation of the caller's config cannot replace them.
    const execute = createExecutor(
      tools,
      vault,
      { tools: [], onAudit: options.onAudit },
      clock,
    );
    return Object.freeze<AgentSecurity>({
      run(input): SecurityRun {
        const scope = trustedScope(input);
        let closed = false;
        const assertOpen = () => {
          if (closed) fail('RUN_CLOSED');
        };
        return Object.freeze<SecurityRun>({
          bind(secret, policy) {
            assertOpen();
            return vault.bindMany([secret], scope, freezePolicy(policy, tools))[0]!;
          },
          redact(text, policy) {
            assertOpen();
            if (typeof text !== 'string' || text.length > 65536)
              fail('INVALID_ARGUMENTS');
            const immutablePolicy = freezePolicy(policy, tools);
            vault.assertAvailable();
            const candidates = detect(text).map(({ start, end }) => ({ start, end }));
            if (candidates.length > 4096) fail('INVALID_ARGUMENTS');
            for (const value of new Set(vault.sensitiveValues())) {
              let start = text.indexOf(value);
              while (start !== -1) {
                if (candidates.length >= 4096) fail('INVALID_ARGUMENTS');
                candidates.push({ start, end: start + value.length });
                start = text.indexOf(value, start + 1);
              }
            }
            // A union of overlapping spans prevents partially exposing a known value.
            candidates.sort((a, b) => a.start - b.start || b.end - a.end);
            const findings: { start: number; end: number }[] = [];
            for (const candidate of candidates) {
              const previous = findings.at(-1);
              if (previous && candidate.start < previous.end)
                previous.end = Math.max(previous.end, candidate.end);
              else findings.push({ ...candidate });
            }
            const values = [...new Set(findings.map((f) => text.slice(f.start, f.end)))];
            const references = vault.bindMany(values, scope, immutablePolicy, text);
            const byValue = new Map(values.map((value, i) => [value, references[i]!]));
            const parts: string[] = [];
            let cursor = 0;
            for (const finding of findings) {
              parts.push(
                text.slice(cursor, finding.start),
                byValue.get(text.slice(finding.start, finding.end))!,
              );
              cursor = finding.end;
            }
            parts.push(text.slice(cursor));
            return Object.freeze({
              text: parts.join(''),
              references,
              count: references.length,
            });
          },
          revoke(reference) {
            assertOpen();
            vault.revoke(reference, scope);
          },
          execute(toolId, args) {
            return execute(scope, toolId, args, closed);
          },
          dispose() {
            closed = true;
            vault.dispose(scope);
          },
        });
      },
    });
  } catch {
    return fail('INVALID_CONFIG');
  }
}
