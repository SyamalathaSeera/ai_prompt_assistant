import { chromium, test as base } from '@playwright/test';
import { EXTENSION_PATH, extensionBuilt } from './support/fixtures';

/**
 * The live smoke test.
 *
 * Everything else in this directory runs against a saved fixture, which is what
 * makes it deterministic and CI-safe. That is also its blind spot: a fixture
 * records what chatgpt.com looked like on the day it was written, so a suite
 * built entirely on fixtures will keep passing serenely after the real page has
 * changed and the extension has stopped working.
 *
 * This test closes that gap by loading the real site. It is **opt-in** and
 * never runs in CI, because it depends on a third party's uptime, markup, and
 * anti-automation measures — a red build caused by any of those would teach
 * people to ignore red, which costs more than the test is worth.
 *
 * When it fails, it is allowed to fail loudly: it means the selectors need
 * attention, which is exactly the signal worth having.
 *
 *   APA_LIVE=1 npm run e2e -- live.spec.ts
 *
 * Expect to be signed out. The check is deliberately shallow — can the composer
 * be resolved at all — because anything deeper would need an account, and a test
 * that requires someone's ChatGPT credentials is a test nobody runs.
 */

const live = process.env.APA_LIVE === '1';

const test = base.extend({});

test.skip(!live || !extensionBuilt, 'set APA_LIVE=1 and build first');

test('the composer is still findable on the real chatgpt.com', async () => {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  try {
    const page = await context.newPage();
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });

    // Give the SPA time to render its composer.
    await page.waitForTimeout(5000);

    const health = await page.evaluate(() => {
      const host = document.querySelector('ai-prompt-assistant');
      return {
        injected: host !== null,
        // The notice only renders when protection is degraded or unavailable,
        // so its ABSENCE is the passing condition.
        notice:
          host?.shadowRoot?.querySelector('[data-testid="apa-health-notice"]')?.textContent ??
          null,
      };
    });

    console.log('\n  LIVE CHECK:', JSON.stringify(health, null, 2), '\n');

    test.expect(health.injected, 'content script did not inject').toBe(true);
    test
      .expect(health.notice, 'the live page reports degraded or unavailable protection')
      .toBeNull();
  } finally {
    await context.close();
  }
});
