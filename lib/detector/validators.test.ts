import { describe, expect, it } from 'vitest';
import {
  hasEnoughDistinctCharacters,
  hasMixedCharacters,
  isInCodeFence,
  isLikelyPlaceholder,
  luhn,
  shannonEntropy,
} from './validators';

describe('luhn', () => {
  it.each([
    ['4539578763621486', 'synthetic Visa-format number'],
    ['4111111111111111', 'published Visa test number'],
    ['5555555555554444', 'published Mastercard test number'],
    ['378282246310005', 'published Amex test number'],
  ])('accepts %s (%s)', (value) => {
    expect(luhn(value)).toBe(true);
  });

  it('accepts grouped formatting with spaces and hyphens', () => {
    expect(luhn('4539 5787 6362 1486')).toBe(true);
    expect(luhn('4539-5787-6362-1486')).toBe(true);
  });

  it('rejects a single transposed digit', () => {
    expect(luhn('4539578763621468')).toBe(false);
  });

  it('rejects a sequential run', () => {
    expect(luhn('1234567890123456')).toBe(false);
  });

  it('rejects anything non-numeric', () => {
    expect(luhn('4539abcd63621486')).toBe(false);
  });

  it('rejects lengths outside the card range', () => {
    expect(luhn('4539')).toBe(false);
    expect(luhn('45395787636214861234')).toBe(false);
  });
});

describe('shannonEntropy', () => {
  it('is zero for a single repeated character', () => {
    expect(shannonEntropy('aaaaaaaa')).toBe(0);
  });

  it('is zero for empty input', () => {
    expect(shannonEntropy('')).toBe(0);
  });

  it('rates random key material above English prose', () => {
    const key = shannonEntropy('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    const prose = shannonEntropy('the quick brown fox jumps over the lazy dog');
    expect(key).toBeGreaterThan(prose);
  });

  it('rates padding far below real key material', () => {
    expect(shannonEntropy('xxxxxxxxxxxxxxxx')).toBeLessThan(
      shannonEntropy('zR9xK2mQ7vL4nP8w'),
    );
  });
});

describe('character helpers', () => {
  it('detects mixed character classes', () => {
    expect(hasMixedCharacters('zR9xK2mQ')).toBe(true);
    expect(hasMixedCharacters('abcdefgh')).toBe(false);
    expect(hasMixedCharacters('12345678')).toBe(false);
  });

  it('rejects values with too few distinct characters', () => {
    expect(hasEnoughDistinctCharacters('xxxxxxxxxxxx')).toBe(false);
    expect(hasEnoughDistinctCharacters('ababababab')).toBe(false);
    expect(hasEnoughDistinctCharacters('zR9xK2mQ7vL4')).toBe(true);
  });
});

describe('isLikelyPlaceholder', () => {
  it('rejects this extension’s own placeholder tokens', () => {
    // This is what makes redaction idempotent — a second pass over already
    // redacted text must find nothing.
    expect(isLikelyPlaceholder('[REDACTED_AWS_ACCESS_KEY_ID_1]')).toBe(true);
    expect(isLikelyPlaceholder('[REDACTED_JWT_12]')).toBe(true);
  });

  it.each([
    '<your-api-key>',
    '{{ vault_token }}',
    '[insert key here]',
    'YOUR_API_KEY',
    'your-secret-here',
    'sk-your-openai-key-here',
    'changeme',
    'CHANGE_ME_PLEASE',
    'xxxxxxxxxxxxxxxx',
    'aaaaaaaaaaaa',
    'example-key-1234',
    'dummy_token_value',
    // AWS's own documentation example secret. It ends in EXAMPLEKEY, which is
    // exactly what it is — a placeholder. Users paste AWS docs constantly, so
    // rejecting it is correct rather than an accident.
    'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  ])('rejects the documentation placeholder %s', (value) => {
    expect(isLikelyPlaceholder(value)).toBe(true);
  });

  it.each([
    'kR7vN2xQ9mL4pW8sT6yB3zA5cF1dG0hJ7nE4uV2q',
    'zR9xK2mQ7vL4nP8w',
    'AKIAIOSFODNN7EXAMPLE',
    'sk_live_abcdefghijklmnopqrstuvwx',
    'ghp_a1B2c3D4e5a1B2c3D4e5a1B2c3D4e5abcdef',
  ])('accepts the credential-shaped value %s', (value) => {
    expect(isLikelyPlaceholder(value)).toBe(false);
  });

  it('does not reject values merely containing a short common word', () => {
    // Short markers like `test` or `key` would suppress genuine credentials.
    // Suppressing a real secret is a leak, so the phrase list is deliberately
    // built from long, distinctive strings only.
    expect(isLikelyPlaceholder('testKeyR9xK2mQ7vL4nP8w')).toBe(false);
    expect(isLikelyPlaceholder('mySecretR9xK2mQ7vL4nP8')).toBe(false);
  });
});

describe('isInCodeFence', () => {
  const ctxAt = (text: string, needle: string) => {
    const start = text.indexOf(needle);
    return { text, start, end: start + needle.length };
  };

  it('detects a match inside an open fence', () => {
    const text = 'before\n```\nAKIAIOSFODNN7EXAMPLE\n```\nafter';
    expect(isInCodeFence(ctxAt(text, 'AKIAIOSFODNN7EXAMPLE'))).toBe(true);
  });

  it('detects a match outside any fence', () => {
    const text = '```\ncode\n```\nAKIAIOSFODNN7EXAMPLE';
    expect(isInCodeFence(ctxAt(text, 'AKIAIOSFODNN7EXAMPLE'))).toBe(false);
  });

  it('returns false when there are no fences at all', () => {
    const text = 'just prose with AKIAIOSFODNN7EXAMPLE in it';
    expect(isInCodeFence(ctxAt(text, 'AKIAIOSFODNN7EXAMPLE'))).toBe(false);
  });
});
