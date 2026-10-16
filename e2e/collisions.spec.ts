import type { Page, Worker } from '@playwright/test';
import { extensionBuilt, expect, shadowClick, shadowHas, test } from './support/fixtures';

test.skip(!extensionBuilt, 'run `npm run build` first');

const classic = 'ghp_' + 'Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1St2Uv3Wx4';
const fine = 'github_pat_' + 'Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1St2Uv3Wx4Yz5'.repeat(2);
const sent = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sent: string[] }).__sent);

async function approve(page: Page, text: string, count: number): Promise<void> {
  await page.locator('#prompt-textarea').fill(text);
  await page.keyboard.press('Enter');
  await expect.poll(() => shadowHas(page, 'apa-modal')).toBe(true);
  await shadowClick(page, 'apa-send-redacted');
  await expect.poll(async () => (await sent(page)).length).toBe(count);
}

type SessionApi = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};
type ExtensionGlobal = typeof globalThis & {
  chrome: { storage: { session: SessionApi } };
};

async function consistent(
  worker: Worker,
  tokens: string[],
  values: string[],
): Promise<boolean> {
  return worker.evaluate(
    async ({ tokens, values }) => {
      const stored = await (globalThis as ExtensionGlobal).chrome.storage.session.get(
        'apa:vault',
      );
      const records = Object.values(
        stored['apa:vault'] as Record<string, { placeholder: string; value: string }>,
      );
      return tokens.every((token, i) =>
        records.some((r) => r.placeholder === token && r.value === values[i]),
      );
    },
    { tokens, values },
  );
}

test('mixed rules and successive prompts retain separate vault mappings', async ({
  openChat,
  context,
  extensionId,
}) => {
  const page = await openChat();
  await approve(page, `${classic} ${fine}`, 1);
  await approve(page, fine, 2);
  const messages = await sent(page);
  const tokens = messages.flatMap(
    (message) => message.match(/\[REDACTED_[A-Z0-9_]+_\d+\]/g) ?? [],
  );
  expect(new Set(tokens).size).toBe(3);
  expect(
    messages.some((message) => message.includes(classic) || message.includes(fine)),
  ).toBe(false);
  const worker = context
    .serviceWorkers()
    .find((worker) => worker.url().includes(extensionId))!;
  expect(await consistent(worker, tokens, [classic, fine, fine])).toBe(true);

  // The real response observer must resolve the first prompt after the second send.
  await page.evaluate((token) => {
    const turn = document.createElement('div');
    turn.dataset.testid = 'conversation-turn-99';
    turn.dataset.turn = 'assistant';
    turn.dataset.turnId = 'turn-99';
    const message = document.createElement('div');
    message.dataset.messageAuthorRole = 'assistant';
    message.id = 'collision-response';
    message.textContent = token;
    turn.append(message);
    document.querySelector('main')!.append(turn);
  }, tokens[0]!);
  await expect
    .poll(
      async () => (await page.locator('#collision-response').textContent()) === classic,
    )
    .toBe(true);
});

test('concurrent tabs retain both acknowledged submissions', async ({
  openChat,
  context,
  extensionId,
}) => {
  const [a, b] = await Promise.all([openChat(), openChat()]);
  await Promise.all([approve(a, classic, 1), approve(b, fine, 1)]);
  const tokens = [...(await sent(a)), ...(await sent(b))];
  expect(new Set(tokens).size).toBe(2);
  const worker = context
    .serviceWorkers()
    .find((worker) => worker.url().includes(extensionId))!;
  expect(await consistent(worker, tokens, [classic, fine])).toBe(true);
});

test('unusable persistence leaves the prompt unsent and explains the failure', async ({
  openChat,
  context,
  extensionId,
}) => {
  const page = await openChat();
  const worker = context
    .serviceWorkers()
    .find((worker) => worker.url().includes(extensionId))!;
  await worker.evaluate(async () => {
    await (globalThis as ExtensionGlobal).chrome.storage.session.set({
      'apa:vault:sequence': { epoch: 'invalid', counter: -1 },
    });
  });
  await page.locator('#prompt-textarea').fill(classic);
  await page.keyboard.press('Enter');
  await expect.poll(() => shadowHas(page, 'apa-modal')).toBe(true);
  await shadowClick(page, 'apa-send-redacted');
  const alert = page.locator('ai-prompt-assistant').locator('[role="alert"]');
  await expect(alert).toContainText('Nothing was sent');
  expect((await sent(page)).length).toBe(0);
  expect((await page.locator('#prompt-textarea').textContent()) === classic).toBe(true);
});
