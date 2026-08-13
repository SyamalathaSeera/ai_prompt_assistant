/**
 * Settings schema.
 *
 * `schemaVersion` exists from day one because settings shapes always change,
 * and users must never lose their configuration on an extension update.
 * Milestone 0.0.6.0 Task 1 adds the migration function.
 */

export type PlaceholderStyle = 'bracketed' | 'dummy';
export type HighTierBehavior = 'block' | 'warn';

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
   * Allowlisted values, stored as hashes only. The plaintext is never
   * persisted, which means the UI can list entries but never display them.
   */
  allowlistHashes: string[];

  /** Hosts the user has explicitly paused, e.g. `chatgpt.com`. */
  pausedHosts: string[];
}

/**
 * Local catch counters. Counts only — never values, never prompt content.
 * This is the "why do I still have this installed" surface in the popup.
 */
export interface Counters {
  totalCatches: number;
  /** ruleId -> count */
  byRule: Record<string, number>;
  /** ISO date of first install, used for the "catches this week" figure. */
  installedAt: string;
}
