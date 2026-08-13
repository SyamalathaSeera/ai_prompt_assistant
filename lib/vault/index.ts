/**
 * Session vault: placeholder -> real value.
 *
 * Implemented in milestone 0.0.5.0. This module deliberately creates the one
 * place in the extension where real secrets exist in memory, so ADR-005
 * constrains it tightly:
 *
 *  - Backed by `chrome.storage.session` — memory-backed, cleared on browser
 *    restart, never synced. NEVER `.local`, NEVER `.sync`. Writing secrets to
 *    disk would turn a tool that prevents secret sprawl into a new place
 *    secrets accumulate.
 *  - Entries are scoped per conversation so placeholders cannot bleed between
 *    chats.
 *  - Hard entry cap with LRU eviction; the vault must not grow unbounded.
 *
 * Consequence, accepted deliberately: re-hydration does not survive a browser
 * restart. A stale placeholder in old scrollback is a far smaller cost than
 * becoming a secret store.
 */

export interface VaultEntry {
  placeholder: string;
  conversationId: string;
  createdAt: number;
}

export function put(
  _placeholder: string,
  _value: string,
  _conversationId: string,
): Promise<void> {
  throw new Error('vault.put() is implemented in milestone 0.0.5.0');
}

/** Returns the real value for a placeholder, or null on a vault miss. */
export function resolve(_placeholder: string): Promise<string | null> {
  throw new Error('vault.resolve() is implemented in milestone 0.0.5.0');
}

/** Clears entries for one conversation, or the whole vault when omitted. */
export function purge(_conversationId?: string): Promise<void> {
  throw new Error('vault.purge() is implemented in milestone 0.0.5.0');
}

/** Entry count, shown in the popup. Visibility into what is held builds trust. */
export function size(): Promise<number> {
  throw new Error('vault.size() is implemented in milestone 0.0.5.0');
}
