import { describe, expect, it } from 'vitest';
import { detect, ALL_RULES, redact } from '../src/index';
import {
  detect as original,
  redact as originalRedact,
} from '../../../lib/detector/engine';
import { ALL_RULES as originalRules } from '../../../lib/detector/rules';

describe('standalone detector facade', () => {
  it('reuses the original engine and registry by identity', () => {
    expect(detect === original).toBe(true);
    expect(redact === originalRedact).toBe(true);
    expect(ALL_RULES === originalRules).toBe(true);
  });
  it('has no browser globals in its test environment', () => {
    expect(typeof (globalThis as Record<string, unknown>).window).toBe('undefined');
    expect(typeof (globalThis as Record<string, unknown>).browser).toBe('undefined');
  });
});
