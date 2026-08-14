import { browser } from 'wxt/browser';

/**
 * Messages between the background worker and the content script.
 *
 * There is exactly one, and it carries no data — the keyboard shortcut is
 * declared as a browser command (so the user can rebind it, and so Chrome
 * refuses bindings that collide with its own), and commands are only delivered
 * to the background worker. This is the hop from there to the page.
 *
 * Deliberately not a general RPC layer. A content script that accepts
 * instructions from anywhere is a surface worth avoiding in an extension whose
 * whole claim is about what it does with the text in front of it.
 */

/** Matches the `commands` key in wxt.config.ts. */
export const REFINE_COMMAND = 'refine-prompt';

export interface RefineMessage {
  type: 'apa:refine';
}

export const REFINE_MESSAGE: RefineMessage = { type: 'apa:refine' };

/**
 * Whether a received message is ours.
 *
 * Validated rather than trusted: `runtime.onMessage` also delivers messages
 * from our own popup and options page, and the shape is whatever the sender
 * chose to send.
 */
export function isRefineMessage(value: unknown): value is RefineMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === REFINE_MESSAGE.type
  );
}

/**
 * Delivers the refine command to the tab the user is looking at.
 *
 * Failure is expected and silent: the shortcut is global, so it fires on any
 * tab, and most tabs have no content script to receive it. Pressing it on a
 * news site should do nothing at all — not raise an error the user has no way
 * to act on.
 */
export async function dispatchRefineToActiveTab(): Promise<void> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== 'number') return;
    await browser.tabs.sendMessage(tab.id, REFINE_MESSAGE);
  } catch {
    /* no receiver in that tab, which is the common case */
  }
}
