import { describe, expect, it } from 'vitest';
import { allAdapters, isSupportedHost, resolveAdapter } from './registry';

describe('resolveAdapter', () => {
  it.each([
    'chatgpt.com',
    'chat.openai.com',
    'www.chatgpt.com',
    'WWW.ChatGPT.COM',
    'chatgpt.com:443',
    '  chatgpt.com  ',
  ])('resolves %s to the ChatGPT adapter', (hostname) => {
    expect(resolveAdapter(hostname)?.id).toBe('chatgpt');
  });

  it.each([
    'example.com',
    'claude.ai',
    'gemini.google.com',
    '',
    '   ',
    'openai.com',
  ])('returns null for %s', (hostname) => {
    expect(resolveAdapter(hostname)).toBeNull();
  });

  it('does not let a lookalike domain masquerade as a supported host', () => {
    // The suffix match anchors on a leading dot, so only genuine subdomains
    // match. Without that anchor, an attacker-controlled `notchatgpt.com`
    // would get our content script injected.
    expect(resolveAdapter('notchatgpt.com')).toBeNull();
    expect(resolveAdapter('evil-chatgpt.com')).toBeNull();
    expect(resolveAdapter('chatgpt.com.evil.net')).toBeNull();
  });

  it('accepts genuine subdomains', () => {
    expect(resolveAdapter('beta.chatgpt.com')?.id).toBe('chatgpt');
  });
});

describe('isSupportedHost', () => {
  it('mirrors resolveAdapter', () => {
    expect(isSupportedHost('chatgpt.com')).toBe(true);
    expect(isSupportedHost('example.com')).toBe(false);
  });
});

describe('allAdapters', () => {
  it('exposes every registered adapter', () => {
    expect(allAdapters().map((a) => a.id)).toEqual(['chatgpt']);
  });

  it('gives every adapter a distinct id', () => {
    const ids = allAdapters().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every adapter at least one host pattern', () => {
    for (const adapter of allAdapters()) {
      expect(adapter.hostPatterns.length).toBeGreaterThan(0);
    }
  });
});
