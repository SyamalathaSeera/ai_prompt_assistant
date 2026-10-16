import { types } from 'node:util';
import type { ReasonCode, Scalar, Schema, Scope } from './types';

const CODES = new Set<string>([
  'INVALID_CONFIG',
  'INVALID_SCOPE',
  'INVALID_POLICY',
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
  'ADAPTER_FAILED',
  'INVALID_OUTPUT',
]);

export class SecurityError extends Error {
  constructor(readonly code: Exclude<ReasonCode, 'OK'>) {
    super(CODES.has(code) ? code : 'INVALID_CONFIG');
    this.code = CODES.has(code) ? code : 'INVALID_CONFIG';
    this.name = 'SecurityError';
  }
}
export function fail(code: Exclude<ReasonCode, 'OK'>): never {
  throw new SecurityError(code);
}
export function reason(
  error: unknown,
  fallback: Exclude<ReasonCode, 'OK'>,
): Exclude<ReasonCode, 'OK'> {
  if (
    error &&
    typeof error === 'object' &&
    !types.isProxy(error) &&
    error instanceof SecurityError
  ) {
    const code: unknown = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    if (typeof code === 'string' && CODES.has(code))
      return code as Exclude<ReasonCode, 'OK'>;
  }
  return fallback;
}

export const ID = /^[a-z][a-z0-9_.-]{0,63}$/;
export const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export const REFERENCE = /^\[\[APA_SECRET_[a-f0-9]{64}\]\]$/;
export const REFERENCE_MARKER = 'APA_SECRET_';

/** Data-only flat records: no getters, proxies, symbols, prototypes or coercion. */
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || types.isProxy(value))
    fail('INVALID_ARGUMENTS');
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail('INVALID_ARGUMENTS');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > 64) fail('INVALID_ARGUMENTS');
  const out: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (
      typeof key !== 'string' ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    )
      fail('INVALID_ARGUMENTS');
    const d = descriptors[key]!;
    if (!('value' in d) || !d.enumerable) fail('INVALID_ARGUMENTS');
    out[key] = d.value;
  }
  return out;
}

export function exactKeys(
  data: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(data).some((key) => !allowed.includes(key))) fail('INVALID_ARGUMENTS');
}

export function trustedScope(input: Scope): Scope {
  try {
    const data = record(input);
    exactKeys(data, ['tenantId', 'principalId', 'runId']);
    for (const key of ['tenantId', 'principalId', 'runId']) {
      if (
        typeof data[key] !== 'string' ||
        !data[key] ||
        (data[key] as string).length > 128
      )
        fail('INVALID_SCOPE');
    }
    return Object.freeze({
      tenantId: data.tenantId as string,
      principalId: data.principalId as string,
      runId: data.runId as string,
    });
  } catch {
    return fail('INVALID_SCOPE');
  }
}

/** Require an explicit origin, not a URL prefix, path, wildcard or normalized lookalike. */
export function httpsOrigin(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 300 ||
    !/^https:\/\/[^/?#\s\\]+$/.test(value)
  )
    fail('DESTINATION_DENIED');
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.origin !== value ||
      url.hostname.endsWith('.') ||
      !url.hostname.includes('.') ||
      url.hostname.startsWith('[') ||
      url.hostname.length > 253 ||
      !url.hostname
        .split('.')
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /(^|\.)localhost$/.test(url.hostname) ||
      /^[\d.]+$/.test(url.hostname)
    )
      fail('DESTINATION_DENIED');
    return url.origin;
  } catch {
    return fail('DESTINATION_DENIED');
  }
}

export function freezeSchema(input: Schema, output = false): Schema {
  const data = record(input);
  const result: Record<string, Schema[string]> = Object.create(null);
  for (const [key, raw] of Object.entries(data)) {
    if (!FIELD.test(key)) fail('INVALID_CONFIG');
    const field = record(raw);
    exactKeys(field, ['type', 'required', 'secret', 'maxLength', 'enum']);
    if (
      !['string', 'number', 'boolean'].includes(field.type as string) ||
      (field.required !== undefined && typeof field.required !== 'boolean') ||
      (field.secret !== undefined && typeof field.secret !== 'boolean') ||
      (field.secret && (output || field.type !== 'string')) ||
      (field.maxLength !== undefined &&
        (!Number.isSafeInteger(field.maxLength) ||
          (field.maxLength as number) < 1 ||
          (field.maxLength as number) > 65536))
    )
      fail('INVALID_CONFIG');
    if (
      field.enum !== undefined &&
      (!Array.isArray(field.enum) ||
        field.enum.length === 0 ||
        field.enum.length > 64 ||
        !field.enum.every(
          (value: unknown) =>
            typeof value === field.type &&
            (typeof value !== 'number' || Number.isFinite(value)) &&
            (typeof value !== 'string' || value.length <= 65536),
        ))
    )
      fail('INVALID_CONFIG');
    result[key] = Object.freeze({
      type: field.type,
      required: field.required ?? true,
      secret: field.secret ?? false,
      maxLength: field.maxLength ?? 65536,
      enum:
        field.enum === undefined
          ? undefined
          : Object.freeze([...(field.enum as Scalar[])]),
    }) as Schema[string];
  }
  return Object.freeze(result);
}

export function scalar(value: unknown, field: Schema[string]): value is Scalar {
  if (
    typeof value !== field.type ||
    (field.enum !== undefined && !field.enum.includes(value as Scalar))
  )
    return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= (field.maxLength ?? 65536);
  return typeof value === 'boolean';
}

export function argumentsSnapshot(
  input: unknown,
  schema: Schema,
): Readonly<Record<string, Scalar>> {
  const data = record(input);
  exactKeys(data, Object.keys(schema));
  const out: Record<string, Scalar> = Object.create(null);
  for (const [key, field] of Object.entries(schema)) {
    if (!Object.hasOwn(data, key)) {
      if (field.required) fail('INVALID_ARGUMENTS');
      else continue;
    }
    if (!scalar(data[key], field)) fail('INVALID_ARGUMENTS');
    out[key] = data[key] as Scalar;
  }
  return Object.freeze(out);
}
