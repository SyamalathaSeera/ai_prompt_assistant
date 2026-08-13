/**
 * Corpus types.
 *
 * Expected secrets are labelled by VALUE rather than by character offset.
 * Offsets go stale the moment anyone edits a document, and a corpus nobody
 * dares edit stops growing — which would defeat its purpose, since the corpus
 * is meant to absorb every false positive reported from beta onward.
 */

export interface ExpectedSecret {
  /** Exact substring the detector must flag. */
  value: string;
  /** Rule expected to catch it. Mismatches are reported but not counted as misses. */
  ruleId: string;
}

export interface PositiveCase {
  name: string;
  /** What kind of document this is, for the metrics table. */
  kind: string;
  text: string;
  secrets: readonly ExpectedSecret[];
}

export interface NegativeCase {
  name: string;
  kind: string;
  /**
   * Realistic text that must produce ZERO high-tier findings.
   *
   * These matter more than the positives. A missed secret is one leak; a rule
   * that fires on ordinary code interrupts the user on every prompt and gets
   * the extension uninstalled.
   */
  text: string;
}
