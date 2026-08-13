import type { MatchContext } from './types';

/**
 * Suppression helpers. Implemented in milestone 0.0.2.0 Task 3.
 *
 * This module carries most of the project's false-positive risk reduction.
 * A redaction tool that cries wolf gets uninstalled within a week, so these
 * gates matter more than adding new rules.
 */

/** Luhn checksum. Gates every credit-card match. */
export function luhn(_value: string): boolean {
  throw new Error('luhn() is implemented in milestone 0.0.2.0');
}

/** Shannon entropy, used to gate generic "high entropy near a keyword" rules. */
export function shannonEntropy(_value: string): number {
  throw new Error('shannonEntropy() is implemented in milestone 0.0.2.0');
}

/**
 * Detects documentation-style dummy values: `your-api-key-here`, `xxxx`,
 * `<REDACTED>`, repeated characters, and our own placeholder format.
 *
 * Users paste documentation snippets constantly, so this gate is load-bearing.
 * It is also what makes `detect(redact(x))` idempotent.
 */
export function isLikelyPlaceholder(_value: string): boolean {
  throw new Error('isLikelyPlaceholder() is implemented in milestone 0.0.2.0');
}

/** Whether the match sits inside a fenced code block. Informs tier for some families. */
export function isInCodeFence(_ctx: MatchContext): boolean {
  throw new Error('isInCodeFence() is implemented in milestone 0.0.2.0');
}
