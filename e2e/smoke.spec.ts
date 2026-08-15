import { extensionBuilt, expect, shadowHas, test } from './support/fixtures';

/**
 * The harness itself.
 *
 * Separate from the journey tests on purpose. If loading the extension breaks,
 * every journey fails at once and the reason is buried — this file makes the
 * cause obvious in one line.
 */

test.skip(!extensionBuilt, 'run `npm run build` first');

test('the extension loads and injects into chatgpt.com', async ({ openChat }) => {
  const page = await openChat();

  // The shadow host is the extension's only footprint on the page.
  await expect(page.locator('ai-prompt-assistant')).toHaveCount(1);
  expect(await shadowHas(page, 'apa-panel')).toBe(true);
});

test('the fixture behaves like the real composer', async ({ openChat }) => {
  /*
   * Guards the fixture, not the extension. A journey that "passes" because the
   * fixture never sends anything would be worthless, so this asserts the mock
   * actually does what chatgpt.com does before anything relies on it.
   */
  const page = await openChat();

  await page.click('#prompt-textarea');
  await page.keyboard.type('hello there');
  await page.keyboard.press('Enter');

  await expect
    .poll(() => page.evaluate(() => (window as never as { __sent: string[] }).__sent))
    .toEqual(['hello there']);
});

test('makes no network requests, following the steps the privacy screen gives', async ({
  openChat,
  context,
}) => {
  /*
   * ADR-001, checked end to end — and specifically, the instruction the privacy
   * statement prints for the user:
   *
   *   1. open DevTools    2. filter Fetch/XHR
   *   3. type something with a key in it
   *   4. watch it get caught, and watch the tab stay empty
   *
   * Steps 3 and 4 are what this reproduces. Telling someone to check something
   * is only worth doing if the check passes, so the instruction on the screen
   * and the assertion here have to be the same instruction.
   *
   * `test/no-network.test.ts` audits the bundle for transport; this watches an
   * actual browser. The fixture route aborts anything not served locally, so a
   * request from the extension shows up here as a failed request rather than as
   * traffic.
   */
  const attempted: string[] = [];
  context.on('requestfailed', (request) => attempted.push(request.url()));
  context.on('request', (request) => attempted.push(request.url()));

  const page = await openChat();
  await page.click('#prompt-textarea');
  await page.keyboard.type('a draft with an AKIA3TZ2MRSYNTHETIC7 key in it');

  // Step 4: the catch actually happens. A network tab that stays empty because
  // the extension did nothing would prove nothing at all.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);

  expect(await shadowHas(page, 'apa-modal')).toBe(true);

  // Only remote schemes count. A `chrome-extension:` URL is the extension
  // reading its own bundled file, which is not a network request in any sense
  // the privacy claim depends on.
  const remote = attempted.filter(
    (url) => /^https?:/.test(url) && !url.startsWith('https://chatgpt.com'),
  );
  expect(remote).toEqual([]);
});
