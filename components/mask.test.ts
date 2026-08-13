import { describe, expect, it } from 'vitest';
import { describeLength, maskValue } from './mask';

describe('maskValue', () => {
  it('reveals the ends of a long value so it can be recognised', () => {
    expect(maskValue('AKIA3TZ2MRSYNTHETIC7')).toBe('AKIA…TIC7');
  });

  it('reveals nothing from a short value', () => {
    // Four characters from each end of a ten-character secret leaks eighty
    // percent of it. Short values are identified by label and position.
    expect(maskValue('hunter2pass')).toBe('•'.repeat(11));
    expect(maskValue('short')).toBe('•••••');
  });

  it('never reveals more than eight characters', () => {
    const revealed = maskValue('a'.repeat(500)).replace('…', '');
    expect(revealed.length).toBeLessThanOrEqual(8);
  });

  it('collapses whitespace so a key block renders on one line', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCA\n-----END RSA PRIVATE KEY-----';
    const masked = maskValue(pem);
    expect(masked).not.toContain('\n');
    expect(masked).toBe('----…----');
  });

  it('handles the empty case', () => {
    expect(maskValue('')).toBe('');
    expect(maskValue('   ')).toBe('');
  });

  it('never returns the original value for anything of real length', () => {
    for (const value of [
      'AKIA3TZ2MRSYNTHETIC7',
      'sk_live_9mQ4vX2nR7tK1pL5wZ8yB3cF',
      'ghp_9mQ4vX2nR7tK1pL5wZ8yB3cF6dH0jS4aE7gU',
    ]) {
      expect(maskValue(value)).not.toBe(value);
      expect(maskValue(value).length).toBeLessThan(value.length);
    }
  });
});

describe('describeLength', () => {
  it('reads naturally', () => {
    expect(describeLength('a')).toBe('1 character');
    expect(describeLength('abcd')).toBe('4 characters');
  });
});
