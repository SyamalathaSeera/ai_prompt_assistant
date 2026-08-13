import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_MATCHES, chatgptAdapter } from '../lib/adapters/chatgpt';
import { resolveAdapter } from '../lib/adapters/registry';

/**
 * WXT extracts content script `matches` at build time, so they have to be
 * literals in the entrypoint rather than imported from the adapter. That
 * creates two sources of truth for the same list.
 *
 * Drift between them is a genuinely bad failure: either the script never
 * injects on a host the adapter claims, or it tries to inject somewhere the
 * manifest holds no host permission. Cheap to prevent, so prevent it.
 */
describe('content script / adapter match patterns', () => {
  it('entrypoint matches are identical to the adapter host patterns', () => {
    const src = readFileSync(
      resolvePath(__dirname, '../entrypoints/content/index.ts'),
      'utf8',
    );
    const block = src.match(/matches:\s*\[([\s\S]*?)\]/)?.[1];
    expect(
      block,
      'could not find a matches array in entrypoints/content/index.ts',
    ).toBeTruthy();

    const declared = [...(block ?? '').matchAll(/'([^']+)'/g)]
      .map((m) => m[1])
      .filter((s): s is string => s !== undefined);
    expect(declared).toEqual([...CHATGPT_MATCHES]);
  });

  it('adapter exposes the same patterns it was built with', () => {
    expect(chatgptAdapter.hostPatterns).toEqual([...CHATGPT_MATCHES]);
  });
});

describe('manifest / registry agreement', () => {
  it('claims a hostname for every host pattern in the manifest', () => {
    // A pattern the manifest injects on but the registry does not claim would
    // mean the content script loads and then quietly does nothing.
    for (const pattern of CHATGPT_MATCHES) {
      const hostname = new URL(pattern.replace('/*', '/')).hostname;
      expect(resolveAdapter(hostname)?.id).toBe('chatgpt');
    }
  });
});
