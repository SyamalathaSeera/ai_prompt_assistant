import { describe, expect, it } from 'vitest';
import { groupFindings, summarize } from './summarize';
import type { Finding } from '@/lib/detector/types';

function finding(
  label: string,
  placeholder: string,
  tier: 'high' | 'low' = 'high',
): Finding {
  return { ruleId: label, label, tier, start: 0, end: 1, placeholder };
}

describe('groupFindings', () => {
  it('counts distinct values, not occurrences', () => {
    // The same key pasted three times is one problem to fix, not three.
    const groups = groupFindings([
      finding('AWS Access Key ID', '[REDACTED_AWS_1]'),
      finding('AWS Access Key ID', '[REDACTED_AWS_1]'),
      finding('AWS Access Key ID', '[REDACTED_AWS_1]'),
    ]);

    expect(groups).toEqual([{ label: 'AWS Access Key ID', count: 1, tier: 'high' }]);
  });

  it('counts two distinct values separately', () => {
    const groups = groupFindings([
      finding('AWS Access Key ID', '[REDACTED_AWS_1]'),
      finding('AWS Access Key ID', '[REDACTED_AWS_2]'),
    ]);

    expect(groups[0]!.count).toBe(2);
  });

  it('puts blocking findings before advisory ones', () => {
    const groups = groupFindings([
      finding('Email Address', '[REDACTED_EMAIL_1]', 'low'),
      finding('Stripe Live Key', '[REDACTED_STRIPE_1]', 'high'),
    ]);

    expect(groups.map((g) => g.label)).toEqual(['Stripe Live Key', 'Email Address']);
  });

  it('orders by count within a tier', () => {
    const groups = groupFindings([
      finding('Stripe Live Key', '[REDACTED_STRIPE_1]'),
      finding('AWS Access Key ID', '[REDACTED_AWS_1]'),
      finding('AWS Access Key ID', '[REDACTED_AWS_2]'),
    ]);

    expect(groups.map((g) => g.label)).toEqual(['AWS Access Key ID', 'Stripe Live Key']);
  });

  it('returns nothing for no findings', () => {
    expect(groupFindings([])).toEqual([]);
  });
});

describe('summarize', () => {
  it('reads naturally for one kind', () => {
    expect(summarize([finding('Stripe Live Key', '[REDACTED_STRIPE_1]')])).toBe(
      '1 Stripe Live Key',
    );
  });

  it('pluralises', () => {
    expect(
      summarize([
        finding('Private Key Block', '[REDACTED_PK_1]'),
        finding('Private Key Block', '[REDACTED_PK_2]'),
      ]),
    ).toBe('2 Private Key Blocks');
  });

  it('joins two kinds with "and"', () => {
    expect(
      summarize([
        finding('AWS Access Key ID', '[REDACTED_AWS_1]'),
        finding('Stripe Live Key', '[REDACTED_STRIPE_1]'),
      ]),
    ).toBe('1 AWS Access Key ID and 1 Stripe Live Key');
  });

  it('collapses beyond three kinds so the sentence stays scannable', () => {
    const summary = summarize([
      finding('A', '[REDACTED_A_1]'),
      finding('B', '[REDACTED_B_1]'),
      finding('C', '[REDACTED_C_1]'),
      finding('D', '[REDACTED_D_1]'),
      finding('E', '[REDACTED_E_1]'),
    ]);

    expect(summary).toContain('2 other kinds');
  });

  it('handles the empty case', () => {
    expect(summarize([])).toBe('No sensitive data found');
  });

  it('never contains a secret value', () => {
    // The summary exists partly so the modal does not put secrets back on
    // screen. It is built from labels and counts only.
    const summary = summarize([finding('AWS Access Key ID', '[REDACTED_AWS_1]')]);
    expect(summary).not.toContain('AKIA');
  });
});
