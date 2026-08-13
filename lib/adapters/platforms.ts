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
  /**
   * A capability this platform does not fully support, in plain language.
   *
   * Shown before the user enables it. A partial capability the user discovers
   * as a silent absence feels like a bug; the same gap stated up front is just
   * a known limit.
   */
  limitation?: string;
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
    supported: true,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    origins: ['https://gemini.google.com/*'],
    required: false,
    supported: true,
    // Re-hydration is unavailable here: Gemini's conversation DOM could not be
    // verified, so `getMessages`/`observeResponse` are deliberately not
    // implemented. Detection and redaction work fully. Stated in the options
    // page so the difference is visible before the user turns it on, rather
    // than discovered as a silent absence afterwards.
    limitation: 'Detects and redacts. Restoring values in replies is not supported yet.',
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

/**
 * Content script registration id for a platform.
 *
 * Namespaced so we never collide with, or remove, a registration belonging to
 * another extension.
 */
function registrationId(platform: Platform): string {
  return `apa-${platform.id}`;
}

/**
 * Registers the content script for a platform the user has just enabled.
 *
 * Granting permission alone does NOT inject anything: the manifest's static
 * content script only covers the hosts declared at build time, and MV3 will
 * not retroactively inject into a newly-permitted origin. Without this, the
 * toggle would appear to work and the extension would do nothing on the new
 * site — a silent failure of exactly the kind this project keeps finding.
 *
 * Registrations persist across browser restarts, so this is idempotent:
 * an existing registration is updated rather than duplicated.
 */
export async function registerContentScript(platform: Platform): Promise<boolean> {
  try {
    const id = registrationId(platform);
    const existing = await browser.scripting.getRegisteredContentScripts({ ids: [id] });

    const script = {
      id,
      matches: platform.origins,
      js: ['content-scripts/content.js'],
      css: ['content-scripts/content.css'],
      runAt: 'document_idle' as const,
    };

    if (existing.length > 0) {
      await browser.scripting.updateContentScripts([script]);
    } else {
      await browser.scripting.registerContentScripts([script]);
    }
    return true;
  } catch {
    // Registration failing means the site simply is not protected. Reported to
    // the caller so the UI can say so rather than claiming success.
    return false;
  }
}

/** Removes a platform's content script registration. */
export async function unregisterContentScript(platform: Platform): Promise<boolean> {
  try {
    await browser.scripting.unregisterContentScripts({ ids: [registrationId(platform)] });
    return true;
  } catch {
    // Already absent is the common case and not an error.
    return false;
  }
}

/**
 * Enables a platform: permission first, then registration.
 *
 * Returns what actually happened, so the UI can distinguish "you declined"
 * from "it broke" — two situations that need different words.
 */
export async function enablePlatform(
  platform: Platform,
): Promise<'enabled' | 'denied' | 'failed'> {
  const granted = await requestPermission(platform);
  if (!granted) return 'denied';

  const registered = await registerContentScript(platform);
  return registered ? 'enabled' : 'failed';
}

/**
 * Disables a platform: unregister first, then drop the permission.
 *
 * Order matters. Revoking the permission first can invalidate the
 * registration's origin and leave a dangling entry that cannot be removed.
 */
export async function disablePlatform(platform: Platform): Promise<void> {
  await unregisterContentScript(platform);
  await revokePermission(platform);
}

/**
 * Re-registers content scripts for platforms that still hold permission.
 *
 * Called from the background worker on startup and install. Dynamic
 * registrations do survive browser restarts, but not every path: an extension
 * update can clear them while the permission remains. This makes the two
 * states agree again, so a user who enabled Claude months ago does not quietly
 * stop being protected on it.
 */
export async function syncRegistrations(): Promise<void> {
  for (const platform of PLATFORMS) {
    if (platform.required || !platform.supported) continue;

    try {
      const granted = await hasPermission(platform);
      if (granted) {
        await registerContentScript(platform);
      } else {
        await unregisterContentScript(platform);
      }
    } catch {
      /* one platform failing must not stop the others */
    }
  }
}
