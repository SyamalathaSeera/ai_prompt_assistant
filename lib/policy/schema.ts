/**
 * Settings schema.
 *
 * `schemaVersion` exists from day one because settings shapes always change,
 * and users must never lose their configuration on an extension update.
 * Milestone 0.0.6.0 Task 1 adds the migration function.
 */

// Defined in the detector, which owns placeholder shape. Re-exported here so
// settings consumers have one import for the settings vocabulary.
import type { PlaceholderStyle } from '../detector/types';

export type { PlaceholderStyle };

export type HighTierBehavior = 'block' | 'warn';

/**
 * One allowlisted value.
 *
 * `hash` is a SHA-256 digest — one-way, so the value can be recognised but
 * never recovered or displayed. The remaining fields exist purely so the
 * options page can show a list a person can act on.
 */
export interface AllowlistEntry {
  hash: string;
  /** Rule label at the time it was allowlisted, e.g. `AWS Access Key ID`. */
  label: string;
  /** ISO date, `YYYY-MM-DD`. */
  addedAt: string;
}

export interface Settings {
  schemaVersion: number;

  /** Master switch. Interception stops entirely when false. */
  enabled: boolean;

  /** Whether high-tier findings hold submission or merely warn. */
  highTierBehavior: HighTierBehavior;

  /** `[REDACTED_AWS_KEY_1]` vs `dummy_api_key_1`. */
  placeholderStyle: PlaceholderStyle;

  /** Scan on paste — the highest-risk moment, so on by default. */
  scanOnPaste: boolean;

  /** Swap real values back into rendered responses (milestone 0.0.5.0). */
  rehydrateResponses: boolean;

  /** Rule ids the user has turned off. */
  disabledRuleIds: string[];

  /**
   * Values the user has told us never to flag again.
   *
   * The plaintext is never persisted, so entries carry only metadata that is
   * not itself sensitive: which rule caught it, and when it was added. That is
   * enough to recognise an entry in a list without the list becoming a place
   * secrets accumulate.
   *
   * A masked preview (`AKIA…TIC7`) was considered and rejected: it would put
   * eight characters of every allowlisted secret on disk permanently, which is
   * hard to square with a product whose claim is that it does not store your
   * secrets.
   */
  allowlist: AllowlistEntry[];

  /** Hosts the user has explicitly paused, e.g. `chatgpt.com`. */
  pausedHosts: string[];

  /**
   * Epoch milliseconds until which protection is suspended everywhere, or null.
   *
   * A timed pause rather than a toggle, because the honest use case is "I am
   * about to paste something I know is fine and I do not want to be asked
   * three times". A pause that stays off until you remember to turn it back on
   * is a pause that silently becomes permanent — and an uninstall that thinks
   * it is still installed.
   */
  pausedUntil: number | null;
}

/**
 * Local catch counters. Counts only — never values, never prompt content.
 * This is the "why do I still have this installed" surface in the popup.
 */
export interface Counters {
  totalCatches: number;
  /** ruleId -> count */
  byRule: Record<string, number>;
  /**
   * `YYYY-MM-DD` -> count, trimmed to a rolling window.
   *
   * A single running total cannot answer "how many this week", and storing a
   * timestamp per catch would be an unnecessary record of when the user was
   * working. A daily histogram answers the question at the coarsest useful
   * granularity and stays bounded.
   */
  byDay: Record<string, number>;
  /** ISO date of first install. */
  installedAt: string;
}
