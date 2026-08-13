import { defineRule } from './shared';
import { luhn } from '../validators';
import type { Rule } from '../types';

/**
 * Payment card numbers.
 *
 * Deferred from Task 2 deliberately: a bare 13-to-19-digit pattern has
 * unacceptable precision, so the family only becomes trustworthy once the
 * Luhn gate exists to back it.
 *
 * Three independent gates, all of which must pass:
 *   1. Luhn checksum — eliminates ~90% of random digit runs
 *   2. a recognised issuer prefix — eliminates most of the rest
 *   3. not a published test card — those appear constantly in documentation
 */

/**
 * Issuer prefixes. A digit run that passes Luhn but belongs to no issuer is
 * far more likely to be an order number or an identifier than a card.
 */
function hasIssuerPrefix(digits: string): boolean {
  return (
    /^4/.test(digits) || // Visa
    /^5[1-5]/.test(digits) || // Mastercard
    /^2(?:2[2-9]|[3-6]\d|7[01]|720)/.test(digits) || // Mastercard 2-series
    /^3[47]/.test(digits) || // American Express
    /^3(?:0[0-5]|[68])/.test(digits) || // Diners Club
    /^6(?:011|5|4[4-9])/.test(digits) || // Discover
    /^35(?:2[89]|[3-8])/.test(digits) || // JCB
    /^62/.test(digits) // UnionPay
  );
}

/**
 * Card numbers published by payment processors as test data. They are
 * Luhn-valid by construction and appear in documentation, sample code, and
 * test suites constantly — flagging one is a pure false positive.
 */
const PUBLISHED_TEST_CARDS = new Set([
  '4111111111111111',
  '4012888888881881',
  '4222222222222',
  '4242424242424242',
  '4000000000000002',
  '4000000000009995',
  '5555555555554444',
  '5105105105105100',
  '5200828282828210',
  '2223003122003222',
  '378282246310005',
  '371449635398431',
  '378734493671000',
  '6011111111111117',
  '6011000990139424',
  '3056930009020004',
  '3566002020360505',
  '6200000000000005',
]);

export const creditCardNumber = defineRule({
  id: 'financial.card_number',
  label: 'Payment Card Number',
  token: 'CARD_NUMBER',
  // 13-19 digits, optionally grouped with single spaces or hyphens.
  pattern: /\b\d(?:[ -]?\d){11,18}\b/g,
  validate: (value) => {
    const digits = value.replace(/[\s-]/g, '');
    if (PUBLISHED_TEST_CARDS.has(digits)) return false;
    if (!hasIssuerPrefix(digits)) return false;
    return luhn(digits);
  },
});

export const financialRules: readonly Rule[] = [creditCardNumber];
