import { DEFAULT_DISABLED_RULE_IDS } from '../detector/rules';
import { DEFAULT_STYLE } from '../refine/prompt';
import type { Counters, Settings } from './schema';

/**
 * Settings schema version.
 *
 * 1 — first shipped shape
 * 2 — `allowlistHashes: string[]` became `allowlist: AllowlistEntry[]`, so the
 *     options page can list entries with a label and a date
 */
export const SCHEMA_VERSION = 2;

/**
 * Default settings.
 *
 * The defaults encode a product judgement: protect assertively where a false
 * positive is near-impossible (high tier blocks), and stay quiet everywhere
 * else. Noisy defaults are what get this category of extension uninstalled,
 * so soft-PII families beyond email and phone ship disabled — see
 * Milestone0.0.2.0 Task 4.
 */
export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  highTierBehavior: 'block',
  placeholderStyle: 'bracketed',
  scanOnPaste: true,
  rehydrateResponses: true,
  // Sourced from the rule definitions themselves so the default experience
  // and the rules cannot drift apart.
  disabledRuleIds: [...DEFAULT_DISABLED_RULE_IDS],
  // The one feature that ships off. It offers an opinion about what the user
  // meant, so it has to be opted into rather than discovered by surprise.
  clarifyEnabled: false,
  refineStyle: DEFAULT_STYLE,
  allowlist: [],
  pausedHosts: [],
  pausedUntil: null,
};

/** How long "pause protection" lasts. Long enough to finish a task, short
 * enough that forgetting about it is self-correcting. */
export const PAUSE_DURATION_MS = 15 * 60 * 1000;

export const DEFAULT_COUNTERS: Counters = {
  totalCatches: 0,
  byRule: {},
  byDay: {},
  installedAt: '',
};

/** How many days of catch history the popup keeps. */
export const COUNTER_HISTORY_DAYS = 30;
