import type { DetectOptions, Finding, RedactionResult } from './types';

/**
 * Detection engine. Implemented in milestone 0.0.2.0.
 *
 * ADR-004: pure. Takes a string, returns findings. No DOM, no I/O.
 *
 * Contract the implementation must honour (see Milestone0.0.2.0 Task 1):
 *  - Overlapping matches resolve deterministically: prefer `high` tier, then
 *    the longer span, then the earlier rule id.
 *  - Repeated occurrences of the same value collapse to one placeholder.
 *  - `detect(redact(x))` must yield no high-tier findings (idempotence).
 */
export function detect(_text: string, _options: DetectOptions = {}): Finding[] {
  throw new Error('detect() is implemented in milestone 0.0.2.0');
}

/**
 * Applies findings to text, returning the redacted string and the
 * placeholder -> value map. Implemented in milestone 0.0.2.0 Task 6.
 *
 * Must apply right-to-left by offset so earlier offsets stay valid as the
 * string is rewritten.
 */
export function redact(_text: string, _findings: readonly Finding[]): RedactionResult {
  throw new Error('redact() is implemented in milestone 0.0.2.0');
}
