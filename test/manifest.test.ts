import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the install-time permission ask.
 *
 * The PRD constrains this directly: install-time permissions must name one
 * site. Every host on the install screen costs conversion, and a privacy tool
 * asking for four of them invites exactly the suspicion it exists to allay.
 *
 * This reads the BUILT manifest rather than the config that produces it, so it
 * checks what users actually see. Requires `npm run build` first; the test
 * skips rather than fails when the build output is absent, so a fresh checkout
 * running `npm test` is not blocked by it.
 */

const MANIFEST_PATH = resolve(__dirname, '../.output/chrome-mv3/manifest.json');

function readManifest(): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const manifest = readManifest();

describe.skipIf(manifest === null)('built manifest', () => {
  it('requests host permission for ChatGPT only', () => {
    expect(manifest!.host_permissions).toEqual([
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
    ]);
  });

  it('keeps every other platform optional', () => {
    expect(manifest!.optional_host_permissions).toEqual([
      'https://claude.ai/*',
      'https://gemini.google.com/*',
    ]);
  });

  it('requests only the API permissions it needs', () => {
    // `scripting` registers content scripts for platforms enabled after
    // install. It grants no host access by itself — injection still requires
    // the host permission the user has just approved.
    expect(manifest!.permissions).toEqual(['storage', 'scripting']);
  });

  it('asks for nothing that would read browsing history', () => {
    // `tabs` would put "Read your browsing history" on the install screen. The
    // popup identifies the active tab without it, because Chrome populates
    // `tab.url` for hosts already permitted.
    const permissions = manifest!.permissions as string[];
    for (const scary of ['tabs', 'history', 'webNavigation', 'cookies', '<all_urls>']) {
      expect(permissions).not.toContain(scary);
    }
  });

  it('ships no localhost permission', () => {
    // WXT adds `http://localhost/*` to DEV builds for hot reload. It must
    // never reach a production build of a tool whose claim is that nothing
    // leaves the machine.
    const hosts = [
      ...((manifest!.host_permissions as string[]) ?? []),
      ...((manifest!.optional_host_permissions as string[]) ?? []),
    ];
    expect(hosts.join(' ')).not.toContain('localhost');
  });

  it('declares no content script for a host it cannot inject into', () => {
    // The static content script must cover exactly the granted hosts;
    // everything else is registered dynamically once permission is given.
    const scripts = manifest!.content_scripts as { matches: string[] }[];
    const granted = manifest!.host_permissions as string[];

    for (const script of scripts) {
      for (const match of script.matches) {
        expect(granted).toContain(match);
      }
    }
  });
});
