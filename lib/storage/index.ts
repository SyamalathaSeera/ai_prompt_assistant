import type { Counters, Settings } from '../policy/schema';

/**
 * Typed wrappers over `chrome.storage.local`. Implemented in milestone
 * 0.0.6.0 Task 1, including change subscriptions so an open ChatGPT tab
 * reacts to settings changes without a reload.
 *
 * Storage split (ADR-005):
 *   .local   settings, allowlist hashes, counters   — persistent
 *   .session vault (real values)                    — memory-backed, see lib/vault
 *
 * Never write secret values here. Never use `.sync` for anything sensitive:
 * it leaves the device, which would contradict the product's core claim.
 */

export function getSettings(): Promise<Settings> {
  throw new Error('getSettings() is implemented in milestone 0.0.6.0');
}

export function setSettings(_patch: Partial<Settings>): Promise<void> {
  throw new Error('setSettings() is implemented in milestone 0.0.6.0');
}

export function onSettingsChanged(_cb: (settings: Settings) => void): () => void {
  throw new Error('onSettingsChanged() is implemented in milestone 0.0.6.0');
}

export function getCounters(): Promise<Counters> {
  throw new Error('getCounters() is implemented in milestone 0.0.6.0');
}

/** Increments the catch counter. Records the rule id and nothing else. */
export function recordCatch(_ruleId: string): Promise<void> {
  throw new Error('recordCatch() is implemented in milestone 0.0.6.0');
}
