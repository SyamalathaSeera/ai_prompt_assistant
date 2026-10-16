import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { detect, placeholderPattern, redact } from '../detector/engine';
import { hydrate } from '../rehydrate';
import { prepareRedaction } from './prepare';
import { clearSession, list, persistRedaction, purge, put, resolve, size } from './index';
import { connectVaultForTests } from './testing';
import { handleVaultRequest } from './service';

const classic = 'ghp_' + 'Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1St2Uv3Wx4';
const fine = 'github_pat_' + 'Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1St2Uv3Wx4Yz5'.repeat(2);
const scope = 'synthetic-conversation';

async function submit(
  text: string,
  style: 'bracketed' | 'dummy' = 'bracketed',
  retain = true,
) {
  const findings = detect(text, { placeholderStyle: style });
  const preview = redact(text, findings).text;
  return prepareRedaction(text, preview, findings, scope, retain);
}

beforeEach(() => {
  fakeBrowser.reset();
  connectVaultForTests();
});

describe('persistent placeholder identities', () => {
  it.each(['bracketed', 'dummy'] as const)(
    'preserves mixed GitHub values across scans with %s',
    async (style) => {
      const first = await submit(`${classic} ${fine} ${classic}`, style);
      const second = await submit(fine, style);
      const tokens = first.match(placeholderPattern())!;
      const next = second.match(placeholderPattern())![0]!;
      expect(new Set([...tokens, next]).size).toBe(3);
      expect(tokens[0] === tokens[2]).toBe(true);
      expect((await resolve(tokens[0]!, scope)) === classic).toBe(true);
      expect((await resolve(tokens[1]!, scope)) === fine).toBe(true);
      expect((await resolve(next, scope)) === fine).toBe(true);
      expect(await resolve(next, 'other-conversation')).toBeNull();
      const root = document.createElement('div');
      root.textContent = first;
      const values = Object.fromEntries(
        await Promise.all(
          tokens.map(async (token) => [token, await resolve(token, scope)]),
        ),
      );
      expect(hydrate(root, values).replaced).toBe(3);
      expect(root.textContent === `${classic} ${fine} ${classic}`).toBe(true);
      expect(detect(second)).toHaveLength(0);
    },
  );

  it('serializes independent concurrent clients and retains every acknowledged mapping', async () => {
    const texts = await Promise.all(
      Array.from({ length: 12 }, (_, i) => submit(i % 2 ? fine : classic)),
    );
    const tokens = texts.map((text) => text.match(placeholderPattern())![0]!);
    expect(new Set(tokens).size).toBe(12);
    const matches = await Promise.all(
      tokens.map(
        async (token, i) => (await resolve(token, scope)) === (i % 2 ? fine : classic),
      ),
    );
    expect(matches.every(Boolean)).toBe(true);
    expect(await size()).toBe(12);
  });

  it('does not let a touch or purge restore a stale snapshot', async () => {
    await put('[REDACTED_OLD_1]', classic, scope);
    await Promise.all([resolve('[REDACTED_OLD_1]', scope), purge(scope), submit(fine)]);
    expect(await resolve('[REDACTED_OLD_1]', scope)).toBeNull();
    expect(await size()).toBe(1);
  });

  it('serializes delete-all after a pending submission', async () => {
    await Promise.all([submit(classic), clearSession()]);
    expect(await size()).toBe(0);
    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
  });

  it('does not reuse identities after purge or entry expiry', async () => {
    const first = await submit(classic);
    await purge();
    const next = await submit(fine);
    expect(first !== next).toBe(true);
    expect(await resolve(first, scope)).toBeNull();
  });

  it('reserves unique identities without retaining values when rehydration is off', async () => {
    const first = await submit(classic, 'bracketed', false);
    const second = await submit(fine, 'bracketed', false);
    expect(first !== second).toBe(true);
    expect(await size()).toBe(0);
    const session = JSON.stringify(await fakeBrowser.storage.session.get(null));
    expect(session.includes(classic) || session.includes(fine)).toBe(false);
  });

  it('rejects read and write failures with static errors and recovers on retry', async () => {
    const first = await submit(classic);
    const get = vi
      .spyOn(fakeBrowser.storage.session, 'get')
      .mockRejectedValueOnce(new Error(fine));
    await expect(submit(fine)).rejects.toThrow(
      'Session vault unavailable; nothing was sent',
    );
    get.mockRestore();
    const set = vi
      .spyOn(fakeBrowser.storage.session, 'set')
      .mockRejectedValueOnce(new Error(classic));
    await expect(submit(fine)).rejects.toThrow(
      'Session vault unavailable; nothing was sent',
    );
    set.mockRestore();
    expect((await resolve(first, scope)) === classic).toBe(true);
    const retry = await submit(fine);
    expect((await resolve(retry, scope)) === fine).toBe(true);
  });

  it('refuses corrupted sequence state rather than reusing a namespace', async () => {
    await fakeBrowser.storage.session.set({
      'apa:vault:sequence': { epoch: 'invalid', counter: -1 },
    });
    await expect(submit(classic)).rejects.toThrow('Session vault unavailable');
    expect(await list()).toHaveLength(0);
  });

  it('remaps whole placeholders once and leaves literal tokens alone', async () => {
    const original = `[REDACTED_GITHUB_TOKEN_1] ${classic}`;
    const sent = await submit(original);
    expect(sent.startsWith('[REDACTED_GITHUB_TOKEN_1] ')).toBe(true);
    const tokens = sent.match(placeholderPattern())!;
    expect(await resolve(tokens[0]!, scope)).toBeNull();
    expect((await resolve(tokens[1]!, scope)) === classic).toBe(true);
  });

  it('rejects malformed requests without returning their content', async () => {
    const result = await handleVaultRequest({
      type: 'apa:vault',
      op: 'persist',
      text: classic,
    });
    expect(result).toEqual({ ok: false });
  });

  it('does not persist unselected mappings or modify user edits', async () => {
    const findings = detect(`${classic} ${fine}`);
    const replacement = `edited ${findings[1]!.placeholder}`;
    const sent = await prepareRedaction(
      `${classic} ${fine}`,
      replacement,
      findings,
      scope,
    );
    expect(sent.startsWith('edited ')).toBe(true);
    expect(await size()).toBe(1);
    expect((await resolve(sent.slice(7), scope)) === fine).toBe(true);
  });

  it('does not reinterpret replacement characters inside secret values', async () => {
    const text = await persistRedaction(
      '[REDACTED_TEST_1]',
      { '[REDACTED_TEST_1]': '$&$1' },
      scope,
    );
    expect((await resolve(text, scope)) === '$&$1').toBe(true);
  });
});

describe('allocation failures and retention', () => {
  it('never reuses a token after the old entry expires', async () => {
    const first = await submit(classic);
    const { TTL_MS } = await import('./limits');
    const data = await fakeBrowser.storage.session.get('apa:vault');
    const records = data['apa:vault'] as Record<string, { lastAccessedAt: number }>;
    for (const record of Object.values(records)) record.lastAccessedAt -= TTL_MS + 1;
    await fakeBrowser.storage.session.set({ 'apa:vault': records });
    const next = await submit(fine);
    expect(first !== next).toBe(true);
    expect(await resolve(first, scope)).toBeNull();
    expect((await resolve(next, scope)) === fine).toBe(true);
  });

  it('rejects a batch that cannot retain every new binding', async () => {
    const entries = Object.fromEntries(
      Array.from({ length: 201 }, (_, i) => [
        `[REDACTED_TEST_${i + 1}]`,
        `synthetic-value-${i}`,
      ]),
    );
    await expect(
      persistRedaction(Object.keys(entries).join(' '), entries, scope),
    ).rejects.toThrow('Session vault unavailable');
    expect(await size()).toBe(0);
  });

  it('rejects a namespace already present in the replacement without changing existing bindings', async () => {
    const first = await submit(classic);
    const forgedNext = first.replace(
      /_(\d+)_1\]$/,
      (_, n: string) => `_${Number(n) + 1}_1]`,
    );
    await expect(
      persistRedaction(
        `[REDACTED_GITHUB_TOKEN_1] ${forgedNext}`,
        { '[REDACTED_GITHUB_TOKEN_1]': fine },
        scope,
      ),
    ).rejects.toThrow('Session vault unavailable');
    expect((await resolve(first, scope)) === classic).toBe(true);
    expect(await size()).toBe(1);
  });
});
