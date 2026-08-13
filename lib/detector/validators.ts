import type { MatchContext } from './types';

/**
 * Suppression helpers.
 *
 * This module carries most of the project's false-positive risk reduction. A
 * redaction tool that cries wolf gets uninstalled within a week, so these
 * gates matter more than adding new rules.
 *
 * The governing asymmetry: suppressing a real secret is a leak, which is the
 * one failure this product cannot have. Every heuristic here is therefore
 * written to be *conservative* — it only rejects a value when that value is
 * clearly not a credential, never on a hunch.
 */

/**
 * Luhn checksum. Gates every credit-card match.
 *
 * Accepts spaces and hyphens as separators, since cards are usually written in
 * groups of four.
 */
export function luhn(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return false;
  if (digits.length < 12 || digits.length > 19) return false;

  let sum = 0;
  let double = false;

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }

  return sum % 10 === 0;
}

/**
 * Shannon entropy in bits per character.
 *
 * Used to gate rules whose patterns are necessarily loose. Random credentials
 * sit high; English words, repeated padding, and structured identifiers sit
 * low. Counted over code points so the result is stable regardless of how the
 * string is encoded.
 */
export function shannonEntropy(value: string): number {
  const chars = [...value];
  if (chars.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const char of chars) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / chars.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/** Real credentials mix character classes; padding and round numbers do not. */
export function hasMixedCharacters(value: string): boolean {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((re) => re.test(value)).length;
  return classes >= 2;
}

/**
 * Rejects values made of too few distinct characters to be a real secret —
 * `XXXXXXXXXXXX`, `000000000000`, `aaaaaaaa`.
 *
 * Not applicable to card numbers, which legitimately repeat digits.
 */
export function hasEnoughDistinctCharacters(value: string): boolean {
  return new Set(value).size >= Math.min(6, Math.ceil(value.length / 3));
}

/**
 * This extension's own placeholder formats — both styles.
 *
 * Must stay in step with `formatPlaceholder` in engine.ts. If a style we emit
 * is not recognised here, a second pass over redacted text would re-detect our
 * own tokens and redaction would stop being idempotent.
 */
const OWN_PLACEHOLDER = [/^\[REDACTED_[A-Z0-9_]+_\d+\]$/, /^dummy_[a-z0-9_]+_\d+$/];

/** Documentation convention: the value is wrapped in brackets of some kind. */
const BRACKET_WRAPPED = /^[<{[(].+[>}\])]$/;

/** A single character repeated, of any length. */
const SINGLE_CHAR_REPEAT = /^(.)\1+$/;

/**
 * Phrases that mark a documentation placeholder.
 *
 * Every entry is at least seven characters, checked against the value with
 * non-alphanumerics stripped. Length is the safety margin: a genuine random
 * credential containing `changeme` or `keygoeshere` as a contiguous run is
 * vanishingly unlikely, whereas a short marker like `test` or `key` would
 * suppress real secrets and cause a leak.
 */
const PLACEHOLDER_PHRASES = [
  'yourapikey',
  'yourapitoken',
  'yoursecret',
  'yourpassword',
  'yourtoken',
  'yourkey',
  'keyhere',
  'tokenhere',
  'secrethere',
  'passwordhere',
  'goeshere',
  'changeme',
  'placeholder',
  'redacted',
  'insertyour',
  'replacewith',
  'examplekey',
  'exampletoken',
  'examplesecret',
  'dummykey',
  'dummytoken',
  'dummysecret',
  'notarealkey',
  'fakekey',
  'faketoken',
] as const;

/**
 * True when a value is documentation boilerplate rather than a real secret.
 *
 * Users paste documentation snippets constantly, so this gate is load-bearing
 * for precision. It is also what makes redaction idempotent: our own
 * placeholder tokens must never be re-detected on a second pass.
 *
 * Checks are structural or anchored on long distinctive phrases — never on
 * short substrings like `test`, which would suppress genuine credentials.
 */
export function isLikelyPlaceholder(value: string): boolean {
  if (OWN_PLACEHOLDER.some((re) => re.test(value))) return true;
  if (BRACKET_WRAPPED.test(value)) return true;
  if (SINGLE_CHAR_REPEAT.test(value)) return true;

  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Eight or more x's in a row is padding in every convention we have seen,
  // and long enough not to collide with real key material.
  if (/x{8,}/.test(normalized)) return true;

  return PLACEHOLDER_PHRASES.some((phrase) => normalized.includes(phrase));
}

/**
 * Whether the match sits inside a fenced code block.
 *
 * Counts fences before the match: an odd number means the match is inside one.
 * Informational only — code fences are where secrets most often get pasted, so
 * this must never be used to suppress a finding on its own.
 */
export function isInCodeFence(ctx: MatchContext): boolean {
  const before = ctx.text.slice(0, ctx.start);
  const fences = before.match(/^[ \t]*```/gm);
  return fences !== null && fences.length % 2 === 1;
}
