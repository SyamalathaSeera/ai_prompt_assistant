import { defineRule } from './shared';
import type { Rule } from '../types';

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Minimal base64url decoder.
 *
 * Hand-rolled rather than using `atob` so this module depends on nothing
 * outside itself. `atob` happens to exist in both Node and browsers, but
 * keeping the detector free of ambient platform APIs is what makes ADR-004
 * checkable rather than a matter of opinion.
 *
 * Returns null on any character outside the alphabet.
 */
function decodeBase64Url(segment: string): string | null {
  let accumulator = 0;
  let bits = 0;
  let out = '';

  for (const char of segment) {
    const value = BASE64URL.indexOf(char);
    if (value < 0) return null;

    accumulator = ((accumulator << 6) | value) & 0xffff;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((accumulator >> bits) & 0xff);
    }
  }

  return out;
}

/**
 * Confirms the first segment really is a JWT header.
 *
 * Three dot-separated base64url runs is a shape that random data can hit. A
 * decodable JSON object carrying an `alg` field is not — this check is what
 * moves the rule from "plausible" to high tier.
 */
export function hasValidJwtHeader(token: string): boolean {
  const header = token.split('.')[0];
  if (header === undefined) return false;

  const json = decodeBase64Url(header);
  if (json === null) return false;

  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null && 'alg' in parsed;
  } catch {
    return false;
  }
}

/**
 * JSON Web Token.
 *
 * `eyJ` is base64url for `{"`, so every JWT header begins with it. The
 * validator then proves the header decodes to real JSON.
 */
export const jsonWebToken = defineRule({
  id: 'auth.jwt',
  label: 'JSON Web Token',
  description: 'Session and access tokens in JSON Web Token format',
  token: 'JWT',
  pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  validate: (value) => hasValidJwtHeader(value),
});

export const jwtRules: readonly Rule[] = [jsonWebToken];
