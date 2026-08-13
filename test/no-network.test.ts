import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ADR-001, enforced against the BUILT bundle.
 *
 * The ESLint rule bans `fetch` in our own source. This checks the shipped
 * artefact instead, which is what a store reviewer or a sceptical user would
 * actually examine — and which includes every dependency's code, not just
 * ours.
 *
 * The claim being defended appears in the store listing, the options page, and
 * onboarding: nothing the user types leaves their device. It is the entire
 * install-time pitch, so it deserves a test rather than a periodic reread.
 */

const OUTPUT = resolve(__dirname, '../.output/chrome-mv3');

function readBundle(name: string): string | null {
  try {
    return readFileSync(resolve(OUTPUT, name), 'utf8');
  } catch {
    return null;
  }
}

const content = readBundle('content-scripts/content.js');
const background = readBundle('background.js');
const built = content !== null && background !== null;

/**
 * Hosts the bundle is allowed to mention.
 *
 * These are match patterns and adapter selectors — strings describing where
 * the extension *runs*, not places it sends anything.
 */
const ALLOWED_HOSTS = [
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'gemini.google.com',
  // Referenced in documentation comments and error messages only.
  'developer.mozilla.org',
  'example.com',
];

/**
 * XML namespace identifiers, which look like URLs but are never fetched.
 *
 * Preact passes these to `createElementNS` when rendering SVG. They are
 * opaque strings the browser compares by value; nothing dereferences them.
 * Listed exactly rather than allowing all of w3.org, so a genuine request to
 * that host would still fail this test.
 */
const XML_NAMESPACES = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xhtml',
];

/** Extracts every absolute http(s) URL literal in a bundle. */
function externalUrls(source: string): string[] {
  const matches = source.match(/https?:\/\/[^\s"'`)\\]+/g) ?? [];

  return [...new Set(matches)].filter((url) => {
    if (XML_NAMESPACES.includes(url)) return false;

    try {
      const { hostname } = new URL(url);
      return !ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
    } catch {
      return false;
    }
  });
}

describe.skipIf(!built)('built bundle makes no external requests', () => {
  it('contains no unexpected external URLs in the content script', () => {
    // A URL literal is not proof of a request, but its absence is strong
    // evidence there is nowhere to send anything.
    expect(externalUrls(content!)).toEqual([]);
  });

  it('contains no unexpected external URLs in the background worker', () => {
    expect(externalUrls(background!)).toEqual([]);
  });

  it('uses no network transports other than the CSS loader', () => {
    for (const [name, source] of [
      ['content script', content!],
      ['background', background!],
    ] as const) {
      expect(source, `${name} uses XMLHttpRequest`).not.toContain('XMLHttpRequest');
      expect(source, `${name} opens a WebSocket`).not.toContain('new WebSocket');
      expect(source, `${name} uses sendBeacon`).not.toContain('sendBeacon');
      expect(source, `${name} uses EventSource`).not.toContain('EventSource');
    }
  });

  it('only ever fetches the extension’s own bundled stylesheet', () => {
    /*
     * Two `fetch` calls exist in the content script, both inside WXT's
     * shadow-root helper. They read
     * `chrome.runtime.getURL('/content-scripts/content.css')` — a
     * chrome-extension:// URL pointing at a file inside the extension package.
     * That is a local file read, not a network request: no host is contacted
     * and nothing leaves the machine.
     *
     * This test pins that explanation. If a fetch ever appears that is not
     * paired with `runtime.getURL`, the claim needs re-examining rather than
     * re-asserting.
     */
    const fetchCount = (content!.match(/fetch\(/g) ?? []).length;
    const runtimeUrlCount = (content!.match(/runtime\.getURL\(/g) ?? []).length;

    expect(fetchCount).toBeLessThanOrEqual(2);
    expect(runtimeUrlCount).toBeGreaterThan(0);
    expect(content!).toContain('/content-scripts/content.css');
  });

  it('ships no analytics or telemetry identifiers', () => {
    for (const marker of [
      'google-analytics',
      'googletagmanager',
      'sentry',
      'mixpanel',
      'amplitude',
      'posthog',
      'segment.io',
    ]) {
      expect(content!.toLowerCase(), `content script references ${marker}`).not.toContain(
        marker,
      );
      expect(background!.toLowerCase(), `background references ${marker}`).not.toContain(
        marker,
      );
    }
  });
});
