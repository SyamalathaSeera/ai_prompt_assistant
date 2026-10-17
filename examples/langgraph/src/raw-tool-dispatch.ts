import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import type {
  AuditEvent,
  ExecutionResult,
  Scalar,
  Schema,
} from '@ai-prompt-assistant/agent-security';

interface RegisteredDispatchTool {
  name: string;
  id: string;
  input: Schema;
  invoke(arguments_: Readonly<Record<string, Scalar>>): Promise<ExecutionResult>;
}

/** Validate original descriptors before any parser can normalize or drop keys.
 * SDK schemas currently allow flat scalars only, so nested objects/arrays are
 * rejected whole, without traversing them or invoking getters/coercions. */
export function strictArgumentSnapshot(
  input: unknown,
  schema: Schema,
): Readonly<Record<string, Scalar>> | null {
  try {
    if (!input || typeof input !== 'object' || types.isProxy(input)) return null;
    if (![Object.prototype, null].includes(Object.getPrototypeOf(input))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 64) return null;
    for (const key of keys) {
      if (
        typeof key !== 'string' ||
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        !Object.hasOwn(schema, key)
      )
        return null;
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    }
    const snapshot: Record<string, Scalar> = Object.create(null);
    for (const [key, field] of Object.entries(schema)) {
      if (!Object.hasOwn(descriptors, key)) {
        if (field.required !== false) return null;
        continue;
      }
      const value: unknown = descriptors[key]!.value;
      if (
        typeof value !== field.type ||
        (typeof value === 'number' && !Number.isFinite(value)) ||
        (typeof value === 'string' && value.length > (field.maxLength ?? 65536)) ||
        (field.enum !== undefined && !field.enum.includes(value as Scalar))
      )
        return null;
      snapshot[key] = value as Scalar;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

/** The only graph dispatch route. Registration and audit callbacks are trusted.
 * No model-provided tool identity or argument data is copied into denial events. */
export function createRawToolDispatcher(
  tools: readonly RegisteredDispatchTool[],
  onDenial: (event: AuditEvent) => void | Promise<void>,
) {
  const registry = new Map(
    tools.map((tool) => [
      tool.name,
      {
        id: tool.id,
        invoke: tool.invoke,
        input: Object.freeze(
          Object.fromEntries(
            Object.entries(tool.input).map(([key, field]) => [
              key,
              Object.freeze({
                ...field,
                ...(field.enum ? { enum: Object.freeze([...field.enum]) } : {}),
              }),
            ]),
          ),
        ),
      },
    ]),
  );
  return async (name: unknown, originalArguments: unknown): Promise<ExecutionResult> => {
    const registered = typeof name === 'string' ? registry.get(name) : undefined;
    const snapshot = registered
      ? strictArgumentSnapshot(originalArguments, registered.input)
      : null;
    if (registered && snapshot) return registered.invoke(snapshot);
    const code = registered ? 'INVALID_ARGUMENTS' : 'UNKNOWN_TOOL';
    const operationId = randomUUID();
    let auditDelivered = false;
    try {
      await onDenial(
        Object.freeze({
          operationId,
          toolId: registered?.id ?? 'unknown',
          outcome: 'denied',
          code,
          bindingCount: 0,
          durationMs: 0,
        }),
      );
      auditDelivered = true;
    } catch {
      /* Never echo an audit exception or retry execution. */
    }
    return Object.freeze({ ok: false, code, operationId, auditDelivered });
  };
}
