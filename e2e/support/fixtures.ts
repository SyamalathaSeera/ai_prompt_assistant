import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

/**
 * End-to-end harness.
 *
 * Everything below exists to answer one question the unit suite structurally
 * cannot: **does the real extension, as built, actually protect a real page?**
 * jsdom proved the pieces work in isolation; 0.0.3.0 showed that live DOM
 * verification catches things no jsdom test would have — a 0×0 decoy textarea,
 * a double-fire on send, a self-interception loop. This suite is that check,
 * automated.
 *
 * Two decisions shape the whole file:
 *
 * **The extension is loaded unmodified, from the production build.** Testing a
 * variant compiled specially for tests would prove something about the variant.
 * The build under `.output/chrome-mv3` is the artefact that would go to the
 * store.
 *
 * **Fixture pages are served AT the real origin.** The content script matches
 * `https://chatgpt.com/*` and nothing else — which is the point of the
 * narrow-permission pitch — so a fixture on localhost would simply never be
 * injected. Requests to the real host are intercepted and fulfilled with local
 * HTML instead, so the URL the browser sees is chatgpt.com while the bytes are
 * ours. Nothing leaves the machine; the network is never reached.
 */

const here = dirname(fileURLToPath(import.meta.url));

export const EXTENSION_PATH = resolve(here, '../../.output/chrome-mv3');
const FIXTURE_DIR = resolve(here, '../fixtures');

/** Whether the extension has been built. Every spec skips without it. */
export const extensionBuilt = existsSync(resolve(EXTENSION_PATH, 'manifest.json'));

export interface PlatformFixture {
  /** Origin the content script is registered for. */
  url: string;
  /** Fixture file under e2e/fixtures. */
  file: string;
}

export const PLATFORMS: Record<string, PlatformFixture> = {
  chatgpt: { url: 'https://chatgpt.com/', file: 'chatgpt.html' },
};

interface Fixtures {
  context: BrowserContext;
  extensionId: string;
  /** Opens a fixture page at its real origin, with the extension injected. */
  openChat: (platform?: keyof typeof PLATFORMS) => Promise<Page>;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    /*
     * A persistent context is required: Chrome will not load an unpacked
     * extension into an incognito-style ephemeral profile, which is what a
     * normal Playwright browser is.
     */
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });

    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    /*
     * The id is derived from the unpacked path, so it is stable per checkout
     * but not knowable in advance. It is read from the service worker's URL —
     * waiting for that worker doubles as proof the extension actually loaded,
     * which is a failure worth catching here rather than as a confusing
     * assertion later.
     */
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');

    await use(new URL(worker.url()).host);
  },

  openChat: async ({ context }, use) => {
    await use(async (platform = 'chatgpt') => {
      const fixture = PLATFORMS[platform]!;
      const html = readFileSync(resolve(FIXTURE_DIR, fixture.file), 'utf8');

      const page = await context.newPage();

      /*
       * Serve our HTML at the real origin, and let nothing else reach the
       * network — a test suite for a product that makes no network requests
       * should not make any either.
       *
       * `chrome-extension:` is explicitly allowed through. The extension loads
       * its own stylesheet into the shadow root from that scheme, which is a
       * local resource read, not a request. Aborting it broke the injected UI
       * and showed up as a phantom "network request" in the very test meant to
       * prove there are none.
       */
      await page.route('**/*', (route) => {
        const url = route.request().url();

        if (url.startsWith(fixture.url)) {
          return route.fulfill({ status: 200, contentType: 'text/html', body: html });
        }
        if (url.startsWith('chrome-extension://') || url.startsWith('data:')) {
          return route.continue();
        }
        return route.abort();
      });

      await page.goto(fixture.url);

      // The panel mounts asynchronously after the content script runs.
      await page.waitForFunction(() => document.querySelector('ai-prompt-assistant') !== null, {
        timeout: 10_000,
      });

      return page;
    });
  },
});

export const expect = test.expect;

/**
 * Reads text out of the extension's shadow DOM.
 *
 * All injected UI lives in a closed-ish shadow root by design (product rule 4),
 * so ordinary selectors cannot see it. Playwright pierces open shadow roots
 * automatically, but the host element has to be the entry point.
 */
export async function shadowText(page: Page, testId: string): Promise<string | null> {
  return page.evaluate((id) => {
    const host = document.querySelector('ai-prompt-assistant');
    const root = host?.shadowRoot;
    const el = root?.querySelector(`[data-testid="${id}"]`);
    return el?.textContent ?? null;
  }, testId);
}

/** Clicks a control inside the extension's shadow DOM. */
export async function shadowClick(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const host = document.querySelector('ai-prompt-assistant');
    const el = host?.shadowRoot?.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, testId);
}

/** Whether an element exists inside the extension's shadow DOM. */
export async function shadowHas(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const host = document.querySelector('ai-prompt-assistant');
    return host?.shadowRoot?.querySelector(`[data-testid="${id}"]`) !== null;
  }, testId);
}
