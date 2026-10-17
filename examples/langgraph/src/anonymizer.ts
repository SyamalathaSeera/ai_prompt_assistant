import { types } from 'node:util';
import { Buffer } from 'node:buffer';
import { createAnonymizer } from 'langsmith/anonymizer';
import { detect, redact } from '@ai-prompt-assistant/detector';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface TraceAnonymizer {
  (input: unknown): Record<string, Json>;
}

/** Pure trace transformation using langsmith 0.11's supported createAnonymizer API. */
export function createTraceAnonymizer(canaries: readonly string[]): TraceAnonymizer {
  const forms = [
    ...new Set(
      canaries
        .filter(Boolean)
        .flatMap((value) => [
          value,
          encodeURIComponent(value),
          Buffer.from(value).toString('base64'),
          Buffer.from(value).toString('hex'),
        ]),
    ),
  ].sort((a, b) => b.length - a.length);
  const scrub = (text: string): string => {
    let value = text;
    for (const form of forms) value = value.split(form).join('[REDACTED]');
    return redact(value, detect(value)).text;
  };
  // maxDepth is checked against the installed API. A separate bounded traversal
  // sanitizes keys, rejects getters/proxies and replaces over-depth subtrees.
  const supportedAnonymizer = createAnonymizer(scrub, { maxDepth: 24 });
  return (input) => {
    let nodes = 0;
    const seen = new Set<object>();
    function visit(value: unknown, depth: number): Json {
      if (++nodes > 20000 || depth > 20) return '[OMITTED]';
      if (typeof value === 'string')
        return value.length > 131072
          ? '[OMITTED]'
          : supportedAnonymizer({ value: scrub(value) }).value;
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (!value || typeof value !== 'object' || types.isProxy(value)) return '[OMITTED]';
      if (seen.has(value)) return '[OMITTED]';
      seen.add(value);
      if (Array.isArray(value)) {
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const length = Math.min(value.length, 1000);
        return Array.from({ length }, (_, i) => {
          const descriptor = descriptors[String(i)];
          return descriptor && 'value' in descriptor
            ? visit(descriptor.value, depth + 1)
            : '[OMITTED]';
        });
      }
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        return '[OMITTED]';
      const result: Record<string, Json> = Object.create(null);
      for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(value),
      ).slice(0, 1000)) {
        const safeKey = key.length > 131072 ? 'omitted_key' : scrub(key);
        if (['__proto__', 'constructor', 'prototype'].includes(safeKey)) continue;
        result[safeKey] =
          'value' in descriptor ? visit(descriptor.value, depth + 1) : '[OMITTED]';
      }
      return result;
    }
    try {
      const value = visit(input, 0);
      return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : { value };
    } catch {
      return { redaction_error: true, error: '[OMITTED]' };
    }
  };
}
