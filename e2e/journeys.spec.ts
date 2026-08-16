import type { Page } from '@playwright/test';
import {
  extensionBuilt,
  expect,
  shadowClick,
  shadowHas,
  shadowText,
  test,
} from './support/fixtures';

/**
 * The journeys that matter.
 *
 * Each one is a thing a user actually does, asserted on **what left the
 * composer** rather than on our own UI. `window.__sent` in the fixture is the
 * ground truth: it records the text the page would have transmitted. A test
 * that checked our modal said the right thing would pass just as happily while
 * sending the secret anyway.
 */

test.skip(!extensionBuilt, 'run `npm run build` first');

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';

/** What the page would have sent. */
const sent = (page: Page) =>
  page.evaluate(() => (window as never as { __sent: string[] }).__sent);

/** Types into the real composer, as a person would. */
async function type(page: Page, text: string) {
  await page.click('#prompt-textarea');
  await page.keyboard.type(text);
}

/** Presses Enter and gives the extension a moment to intervene. */
async function submit(page: Page) {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}

test.describe('a clean prompt', () => {
  test('sends untouched, with nothing shown', async ({ openChat }) => {
    /*
     * The overwhelmingly common path, and the one where a regression is most
     * expensive: if this breaks, every prompt is interrupted and the extension
     * is uninstalled within the hour.
     */
    const page = await openChat();

    await type(page, 'What is the capital of France?');
    await submit(page);

    expect(await sent(page)).toEqual(['What is the capital of France?']);
    expect(await shadowHas(page, 'apa-modal')).toBe(false);
  });
});

test.describe('a prompt containing a secret', () => {
  test('is held before it can leave', async ({ openChat }) => {
    const page = await openChat();

    await type(page, `deploy with ${AWS_KEY} please`);
    await submit(page);

    // Nothing sent, and the user is being asked.
    expect(await sent(page)).toEqual([]);
    expect(await shadowHas(page, 'apa-modal')).toBe(true);
  });

  test('names what it found without showing the value in full', async ({ openChat }) => {
    const page = await openChat();

    await type(page, `deploy with ${AWS_KEY} please`);
    await submit(page);

    const list = await shadowText(page, 'apa-finding-list');
    expect(list).toContain('AWS');
    // The panel may be over a shared screen or a recorded call.
    expect(list).not.toContain(AWS_KEY);
  });

  test('sends the redacted version when the user approves', async ({ openChat }) => {
    const page = await openChat();

    await type(page, `deploy with ${AWS_KEY} please`);
    await submit(page);
    await shadowClick(page, 'apa-send-redacted');
    await page.waitForTimeout(600);

    const messages = await sent(page);
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain(AWS_KEY);
    expect(messages[0]).toContain('[REDACTED_');
    // Redaction has to preserve the request, or the model cannot answer it.
    expect(messages[0]).toContain('deploy with');
    expect(messages[0]).toContain('please');
  });

  test('sends the original when the user insists, after confirming', async ({
    openChat,
  }) => {
    /*
     * Their prompt, their call — a tool that refuses is a tool that gets
     * removed. But it takes two clicks: the first reveals a confirmation, the
     * second sends. Worth asserting both steps rather than only the outcome,
     * because the confirmation is the design and a regression that removed it
     * would still pass an outcome-only test.
     */
    const page = await openChat();

    await type(page, `deploy with ${AWS_KEY} please`);
    await submit(page);

    await shadowClick(page, 'apa-send-original');
    await page.waitForTimeout(200);

    // Nothing has gone yet.
    expect(await sent(page)).toEqual([]);
    expect(await shadowHas(page, 'apa-send-original-confirm')).toBe(true);

    await shadowClick(page, 'apa-send-original-confirm');
    await page.waitForTimeout(600);

    expect(await sent(page)).toEqual([`deploy with ${AWS_KEY} please`]);
  });

  test('dismissing sends nothing and keeps the text', async ({ openChat }) => {
    /*
     * The default that has to be right. Escape and the close button are
     * dismissal gestures — a security tool that transmits a secret when the
     * user waves it away has the default exactly backwards.
     */
    const page = await openChat();

    await type(page, `deploy with ${AWS_KEY} please`);
    await submit(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    expect(await sent(page)).toEqual([]);

    // Nothing is lost: the draft is still in the composer to edit or re-send.
    const draft = await page.textContent('#prompt-textarea');
    expect(draft).toContain(AWS_KEY);
  });
});

test.describe('a secret written in a sentence', () => {
  test('catches both the key and the password', async ({ openChat }) => {
    /*
     * A regression test taken straight from real use.
     *
     * This exact draft was typed into chatgpt.com and only the AWS key was
     * caught. `env.secret_assignment` is anchored to the start of a line — it
     * is built for `.env` pastes — so a password written mid-sentence, which is
     * how people actually type in a chat window, was invisible to it.
     *
     * The corpus could not have found this: every config sample in it puts
     * assignments at line start, so the corpus and the rule agreed with each
     * other and neither noticed. It took five minutes of using the thing.
     */
    const page = await openChat();

    await type(page, `deploy with ${AWS_KEY} and password: Syam_123*`);
    await submit(page);

    expect(await sent(page)).toEqual([]);
    expect(await shadowHas(page, 'apa-modal')).toBe(true);

    // The key blocks. That was already true and must stay true.
    const blocking = await shadowText(page, 'apa-finding-list');
    expect(blocking).toContain('AWS');

    // The password is advisory, so it sits behind the disclosure rather than
    // holding the message. Expanding it is the assertion that it exists at all.
    expect(await shadowHas(page, 'apa-advisory-toggle')).toBe(true);
    await shadowClick(page, 'apa-advisory-toggle');
    await page.waitForTimeout(200);

    const advisory = await shadowText(page, 'apa-advisory-list');
    expect(advisory).toContain('sentence');

    // Neither value is ever printed in full, advisory or not.
    const all = await shadowText(page, 'apa-modal');
    expect(all).not.toContain(AWS_KEY);
    expect(all).not.toContain('Syam_123*');
  });

  test('redacting takes both out', async ({ openChat }) => {
    const page = await openChat();

    await type(page, `deploy with ${AWS_KEY} and password: Syam_123*`);
    await submit(page);
    await shadowClick(page, 'apa-send-redacted');
    await page.waitForTimeout(600);

    const messages = await sent(page);
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain(AWS_KEY);
    expect(messages[0]).not.toContain('Syam_123*');
    expect(messages[0]).toContain('deploy with');
  });
});

test.describe('the risk indicator', () => {
  test('warns while typing, before anything is submitted', async ({ openChat }) => {
    const page = await openChat();

    await type(page, `my key is ${AWS_KEY}`);
    // The live scanner debounces at 250ms.
    await page.waitForTimeout(800);

    expect(await shadowHas(page, 'apa-risk-badge')).toBe(true);
  });
});

test.describe('a broken adapter', () => {
  test('is caught by the suite rather than passing quietly', async ({ openChat }) => {
    /*
     * The milestone's own success criterion: "the suite catches a deliberately
     * broken adapter". Rather than shipping a broken build, this breaks the
     * PAGE in the way a ChatGPT redesign would — renaming the composer so every
     * platform-specific selector misses.
     *
     * The extension should still protect, via the heuristics added in Task 1,
     * and should say it is running degraded. If it silently stopped protecting,
     * this test fails — which is exactly the failure the milestone exists to
     * make impossible.
     */
    const page = await openChat();

    await page.evaluate(() => {
      const composer = document.getElementById('prompt-textarea')!;
      composer.removeAttribute('id');
      composer.removeAttribute('role');
      composer.classList.remove('ProseMirror');
      // Defeats every `contenteditable="true"` selector, including the generic
      // largest-editable tail. A real and plausible attribute value.
      composer.setAttribute('contenteditable', 'plaintext-only');
      // The id carried the styling, so without this the element collapses to
      // zero height and Playwright will not click it. A composer nobody can
      // see is not the scenario under test.
      composer.setAttribute('style', 'flex:1;min-height:52px;padding:14px;border:1px solid #ccc');
    });

    const composer = page.locator('[contenteditable="plaintext-only"]');
    await composer.click();
    await page.keyboard.type(`deploy with ${AWS_KEY}`);
    await page.waitForTimeout(1200);

    // Still protected: the submission is held despite every named selector
    // having failed.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);

    expect(await sent(page)).toEqual([]);
  });

  test('says so when the composer cannot be found at all', async ({ openChat }) => {
    // Total failure must be visible. A security tool that quietly stops working
    // is worse than one that is obviously off.
    const page = await openChat();

    await page.evaluate(() => {
      document.getElementById('composer-form')?.remove();
    });

    // The health monitor rechecks on a throttled mutation observer.
    await expect
      .poll(() => shadowHas(page, 'apa-health-notice'), { timeout: 15_000 })
      .toBe(true);

    expect(await shadowText(page, 'apa-health-message')).toContain(
      'Protection unavailable',
    );
  });
});
