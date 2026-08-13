import { DEFAULT_DISABLED_RULE_IDS } from '../detector/rules';
import type { Counters, Settings } from './schema';

export const SCHEMA_VERSION = 1;

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
  allowlistHashes: [],
  pausedHosts: [],
};

export const DEFAULT_COUNTERS: Counters = {
  totalCatches: 0,
  byRule: {},
  installedAt: '',
};
