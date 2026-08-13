import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  disablePlatform,
  enablePlatform,
  hasPermission,
  PLATFORMS,
  registerContentScript,
  syncRegistrations,
  unregisterContentScript,
} from './platforms';

const claude = PLATFORMS.find((p) => p.id === 'claude')!;
const gemini = PLATFORMS.find((p) => p.id === 'gemini')!;
const chatgpt = PLATFORMS.find((p) => p.id === 'chatgpt')!;

/** fakeBrowser has no scripting namespace, so it is supplied per test. */
function stubScripting() {
  const registered: { id: string; matches: string[] }[] = [];

  const scripting = {
    getRegisteredContentScripts: vi.fn(({ ids }: { ids?: string[] } = {}) =>
      Promise.resolve(ids ? registered.filter((s) => ids.includes(s.id)) : registered),
    ),
    registerContentScripts: vi.fn((scripts: { id: string; matches: string[] }[]) => {
      registered.push(...scripts);
      return Promise.resolve();
    }),
    updateContentScripts: vi.fn(() => Promise.resolve()),
    unregisterContentScripts: vi.fn(({ ids }: { ids: string[] }) => {
      for (const id of ids) {
        const i = registered.findIndex((s) => s.id === id);
        if (i >= 0) registered.splice(i, 1);
      }
      return Promise.resolve();
    }),
  };

  // The code under test reaches for `browser`, which WXT maps onto
  // fakeBrowser, so only that needs the namespace.
  (fakeBrowser as unknown as { scripting: unknown }).scripting = scripting;
  return { scripting, registered };
}

function stubPermissions(granted: boolean) {
  const state = { granted };
  const permissions = {
    contains: vi.fn(() => Promise.resolve(state.granted)),
    request: vi.fn(() => {
      state.granted = true;
      return Promise.resolve(true);
    }),
    remove: vi.fn(() => {
      state.granted = false;
      return Promise.resolve(true);
    }),
  };
  (fakeBrowser as unknown as { permissions: unknown }).permissions = permissions;
  return { permissions, state };
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.unstubAllGlobals();
});

describe('platform declarations', () => {
  it('requests exactly one platform at install', () => {
    // Every host on the install screen costs conversion, and a privacy tool
    // asking for several invites the suspicion it is trying to allay.
    const required = PLATFORMS.filter((p) => p.required);
    expect(required.map((p) => p.id)).toEqual(['chatgpt']);
  });

  it('marks every platform with a working adapter as supported', () => {
    expect(claude.supported).toBe(true);
    expect(gemini.supported).toBe(true);
  });

  it('states Gemini’s known limitation before it is enabled', () => {
    // A partial capability discovered as a silent absence feels like a bug;
    // the same gap stated up front is just a known limit.
    expect(gemini.limitation).toBeTruthy();
    expect(gemini.limitation).toContain('replies');
    expect(claude.limitation).toBeUndefined();
  });
});

describe('enabling a platform', () => {
  it('requests permission and registers the content script', () => {
    // Permission alone injects nothing: the manifest's static content script
    // only covers hosts declared at build time, so without registration the
    // toggle would appear to work and the extension would do nothing.
    const { scripting } = stubScripting();
    const { permissions } = stubPermissions(false);

    return enablePlatform(claude).then((result) => {
      expect(result).toBe('enabled');
      expect(permissions.request).toHaveBeenCalledWith({
        origins: ['https://claude.ai/*'],
      });
      expect(scripting.registerContentScripts).toHaveBeenCalled();
    });
  });

  it('reports a declined permission without registering anything', async () => {
    const { scripting } = stubScripting();
    (fakeBrowser as unknown as { permissions: unknown }).permissions = {
      contains: () => Promise.resolve(false),
      request: () => Promise.resolve(false),
      remove: () => Promise.resolve(true),
    };

    expect(await enablePlatform(claude)).toBe('denied');
    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it('distinguishes a failed setup from a declined one', async () => {
    // "You declined" and "it broke" need different words in the UI.
    stubScripting();
    stubPermissions(false);
    (fakeBrowser as unknown as { scripting: { registerContentScripts: unknown } }).scripting.registerContentScripts =
      () => Promise.reject(new Error('registration failed'));

    expect(await enablePlatform(claude)).toBe('failed');
  });

  it('updates rather than duplicating an existing registration', async () => {
    const { scripting, registered } = stubScripting();
    stubPermissions(true);

    await registerContentScript(claude);
    await registerContentScript(claude);

    expect(registered).toHaveLength(1);
    expect(scripting.updateContentScripts).toHaveBeenCalled();
  });

  it('namespaces registration ids so other extensions are untouched', async () => {
    const { registered } = stubScripting();
    stubPermissions(true);

    await registerContentScript(claude);

    expect(registered[0]!.id).toBe('apa-claude');
  });
});

describe('disabling a platform', () => {
  it('unregisters before revoking', async () => {
    // Revoking first can invalidate the registration's origin and leave a
    // dangling entry that cannot then be removed.
    const order: string[] = [];
    const { scripting } = stubScripting();
    const { permissions } = stubPermissions(true);

    scripting.unregisterContentScripts.mockImplementation(() => {
      order.push('unregister');
      return Promise.resolve();
    });
    permissions.remove.mockImplementation(() => {
      order.push('revoke');
      return Promise.resolve(true);
    });

    await disablePlatform(claude);

    expect(order).toEqual(['unregister', 'revoke']);
  });

  it('stops injection on that host', async () => {
    const { registered } = stubScripting();
    stubPermissions(true);

    await registerContentScript(claude);
    expect(registered).toHaveLength(1);

    await disablePlatform(claude);
    expect(registered).toHaveLength(0);
  });

  it('does not throw when nothing was registered', async () => {
    stubScripting();
    stubPermissions(false);
    await expect(unregisterContentScript(claude)).resolves.toBeDefined();
  });
});

describe('syncRegistrations', () => {
  it('registers platforms that still hold permission', async () => {
    // An extension update can clear dynamic registrations while the host
    // permission remains — a user who enabled Claude months ago would quietly
    // stop being protected, with the toggle still showing on.
    const { registered } = stubScripting();
    stubPermissions(true);

    await syncRegistrations();

    expect(registered.map((s) => s.id).sort()).toEqual(['apa-claude', 'apa-gemini']);
  });

  it('removes registrations for platforms no longer permitted', async () => {
    const { registered } = stubScripting();
    stubPermissions(true);
    await syncRegistrations();
    expect(registered.length).toBeGreaterThan(0);

    stubPermissions(false);
    await syncRegistrations();

    expect(registered).toEqual([]);
  });

  it('never registers the platform granted at install', async () => {
    // ChatGPT is covered by the manifest's static content script; a dynamic
    // registration would inject it twice.
    const { registered } = stubScripting();
    stubPermissions(true);

    await syncRegistrations();

    expect(registered.map((s) => s.id)).not.toContain('apa-chatgpt');
  });

  it('keeps going when one platform fails', async () => {
    const { registered } = stubScripting();
    stubPermissions(true);

    let calls = 0;
    (fakeBrowser as unknown as { permissions: { contains: unknown } }).permissions.contains =
      () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('boom'));
        return Promise.resolve(true);
      };

    await syncRegistrations();

    expect(registered.length).toBeGreaterThan(0);
  });
});

describe('hasPermission', () => {
  it('reports false rather than throwing when the API is unavailable', async () => {
    (fakeBrowser as unknown as { permissions: unknown }).permissions = {
      contains: () => Promise.reject(new Error('unavailable')),
    };

    expect(await hasPermission(chatgpt)).toBe(false);
  });
});
