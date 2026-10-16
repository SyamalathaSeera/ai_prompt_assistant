import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { detect } from '../../detector/src/index';
import type {
  AuditEvent,
  CoreOptions,
  ExecutionResult,
  FixedServiceTool,
  SafeOutput,
  Scalar,
  Scope,
  ReasonCode,
} from './types';
import {
  argumentsSnapshot,
  fail,
  httpsOrigin,
  reason,
  record,
  REFERENCE,
  REFERENCE_MARKER,
  scalar,
} from './safety';
import type { Vault } from './vault';

function sensitive(text: string, values: readonly string[]): boolean {
  if (text.includes(REFERENCE_MARKER)) return true;
  for (const value of values) {
    if (
      [
        value,
        encodeURIComponent(value),
        Buffer.from(value).toString('base64'),
        Buffer.from(value).toString('hex'),
      ].some((form) => form && text.includes(form))
    )
      return true;
  }
  return detect(text).length > 0;
}

function sanitizeOutput(
  input: unknown,
  tool: FixedServiceTool,
  values: readonly string[],
): SafeOutput {
  const data = record(input);
  const output: Record<string, Scalar | null> = Object.create(null);
  for (const [field, schema] of Object.entries(tool.output)) {
    if (!Object.hasOwn(data, field)) {
      if (schema.required) fail('INVALID_OUTPUT');
      else continue;
    }
    const value = data[field];
    if (!scalar(value, schema)) fail('INVALID_OUTPUT');
    if (sensitive(field, values)) fail('INVALID_OUTPUT');
    // Replace the whole scalar with null: no partial value or replacement text can leak.
    output[field] = sensitive(String(value), values) ? null : value;
  }
  return Object.freeze(output);
}

export function createExecutor(
  tools: ReadonlyMap<string, FixedServiceTool>,
  vault: Vault,
  options: CoreOptions,
  clock: () => number,
) {
  return async (
    scope: Scope,
    toolId: string,
    input: unknown,
    closed: boolean,
  ): Promise<ExecutionResult> => {
    let operationId: string;
    try {
      operationId = randomUUID();
    } catch {
      return Object.freeze({
        ok: false,
        code: 'VAULT_UNAVAILABLE',
        operationId: 'unavailable',
        auditDelivered: false,
      });
    }
    let started = 0;
    let bindingCount = 0;
    let invoked = false;
    const protectedValues = new Set<string>(vault.sensitiveValues());
    // Unknown, model-provided IDs are never copied to audit events.
    const tool = typeof toolId === 'string' ? tools.get(toolId) : undefined;
    let result:
      | { ok: true; code: 'OK'; output: SafeOutput }
      | { ok: false; code: Exclude<ReasonCode, 'OK'> };
    try {
      vault.assertAvailable();
      started = clock();
      if (closed) fail('RUN_CLOSED');
      if (!tool) fail('UNKNOWN_TOOL');
      const origin = httpsOrigin(tool.origin);
      const args = argumentsSnapshot(input, tool.input);
      const restored: Record<string, Scalar> = Object.create(null);
      const used: string[] = [];
      // Authorize the entire immutable snapshot before invoking any adapter.
      for (const [field, value] of Object.entries(args)) {
        if (typeof value === 'string' && REFERENCE.test(value)) {
          if (!tool.input[field]!.secret) fail('FIELD_DENIED');
          restored[field] = vault.authorize(value, scope, tool.id, origin, field);
          used.push(restored[field] as string);
          bindingCount++;
        } else {
          if (
            tool.input[field]!.secret ||
            (typeof value === 'string' && value.includes(REFERENCE_MARKER))
          )
            fail('INVALID_REFERENCE');
          if (sensitive(String(value), vault.sensitiveValues())) fail('RAW_SECRET');
          restored[field] = value;
        }
      }
      const request = Object.freeze({
        origin,
        redirect: 'error' as const,
        arguments: Object.freeze(restored),
      });
      invoked = true;
      let raw: unknown;
      try {
        raw = await tool.invoke(request);
      } catch {
        fail('ADAPTER_FAILED');
      }
      const response = record(raw);
      if (
        !Number.isInteger(response.status) ||
        (response.status as number) < 100 ||
        (response.status as number) > 599
      )
        fail('INVALID_OUTPUT');
      if (
        response.redirected !== false ||
        ((response.status as number) >= 300 && (response.status as number) < 400)
      )
        fail('REDIRECT_DENIED');
      if (httpsOrigin(response.origin) !== origin) fail('DESTINATION_DENIED');
      if ((response.status as number) >= 400) fail('ADAPTER_FAILED');
      const output = sanitizeOutput(response.data, tool, [
        ...used,
        ...vault.sensitiveValues(),
      ]);
      result = { ok: true, code: 'OK', output };
    } catch (error) {
      result = {
        ok: false,
        code: reason(error, invoked ? 'ADAPTER_FAILED' : 'VAULT_UNAVAILABLE'),
      };
    }
    let durationMs = 0;
    try {
      const elapsed = clock() - started;
      if (Number.isFinite(elapsed)) durationMs = Math.max(0, elapsed);
    } catch {
      /* No untrusted diagnostics. */
    }
    const event: AuditEvent = Object.freeze({
      operationId,
      toolId: tool?.id ?? 'unknown',
      outcome: result.ok ? 'allowed' : invoked ? 'failed' : 'denied',
      code: result.code,
      bindingCount,
      durationMs,
    });
    let auditDelivered = false;
    try {
      for (const value of vault.sensitiveValues()) protectedValues.add(value);
      const serialized = JSON.stringify(event);
      const unsafeMetadata = [...protectedValues].some((value) =>
        [
          value,
          encodeURIComponent(value),
          Buffer.from(value).toString('base64'),
          Buffer.from(value).toString('hex'),
        ].some((form) => form && serialized.includes(form)),
      );
      if (options.onAudit && !unsafeMetadata) {
        await options.onAudit(event);
        auditDelivered = true;
      }
    } catch {
      /* Delivery failure never re-executes a tool or exposes an exception. */
    }
    return Object.freeze({ ...result, operationId, auditDelivered }) as ExecutionResult;
  };
}
