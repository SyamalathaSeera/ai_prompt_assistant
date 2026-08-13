import { browser } from 'wxt/browser';

/**
 * Optional platform support.
 *
 * ChatGPT is granted at install; everything else is requested at the moment
 * the user turns it on. Every host on the install screen costs conversion, and
 * a privacy tool asking for four sites up front invites exactly the suspicion
 * it is trying to allay.
 *
 * MV3 requires `permissions.request()` to run inside a user gesture, so these
 * are called directly from click handlers — never after an await.
 */

export interface Platform {
  id: string;
  label: string;
  /** Match patterns, exactly as declared in the manifest. */
  origins: string[];
  /** Granted at install and not removable. */
  required: boolean;
  /** Whether an adapter exists yet. */
  supported: boolean;
}

export const PLATFORMS: readonly Platform[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    origins: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    required: true,
    supported: true,
  },
  {
    id: 'claude',
    label: 'Claude',
    origins: ['https://claude.ai/*'],
    required: false,
    // Adapter arrives in milestone 0.1.0.0. Listed so the options page can
    // show what is coming without pretending it works.
    supported: false,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    origins: ['https://gemini.google.com/*'],
    required: false,
    supported: false,
  },
];

/** Whether the extension currently holds permission for a platform. */
export async function hasPermission(platform: Platform): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: platform.origins });
  } catch {
    return false;
  }
}

/**
 * Requests permission for a platform.
 *
 * Must be called synchronously from a click handler — awaiting first loses the
 * user gesture and Chrome rejects the request.
 */
export async function requestPermission(platform: Platform): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: platform.origins });
  } catch {
    return false;
  }
}

/** Gives a platform's permission back. */
export async function revokePermission(platform: Platform): Promise<boolean> {
  try {
    return await browser.permissions.remove({ origins: platform.origins });
  } catch {
    return false;
  }
}
