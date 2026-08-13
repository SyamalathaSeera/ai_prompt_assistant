import { defineRule } from './shared';
import type { MatchContext, Rule } from '../types';

/**
 * Soft personally-identifying information.
 *
 * Everything here is LOW tier: surfaced as a suggestion, never blocking
 * submission. The tier is the whole design. High-tier rules must be precise
 * enough that firing on innocent text is a bug; these families cannot reach
 * that bar, so instead of weakening the high tier they live somewhere that
 * tolerates the occasional miss.
 *
 * PERSON NAMES ARE DELIBERATELY ABSENT. Detecting them without an NER model
 * means matching capitalised words, which fires on every proper noun in every
 * prompt. A tool that flags the user's own name constantly gets uninstalled in
 * a day, and the cost lands on exactly the careful users worth keeping.
 * Revisit only with an on-device model — see PRD "Out of scope for MVP".
 */

/** Domains used in documentation and examples rather than by real people. */
const EXAMPLE_DOMAINS = [
  'example.com',
  'example.org',
  'example.net',
  'example.edu',
  'test.com',
  'domain.com',
  'yourdomain.com',
  'mydomain.com',
  'email.com',
  'acme.com',
  'company.com',
  'mycompany.com',
  'localhost',
];

export const emailAddress = defineRule({
  id: 'pii.email',
  label: 'Email Address',
  description: 'Email addresses, excluding documentation examples',
  token: 'EMAIL',
  tier: 'low',
  pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
  validate: (value) => {
    const domain = value.slice(value.indexOf('@') + 1).toLowerCase();
    return !EXAMPLE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
  },
});

/**
 * Phone numbers in E.164 or common separator-delimited national form.
 *
 * A bare run of ten digits is not matched: it is indistinguishable from an
 * order number, and the noise would swamp the real hits.
 */
export const phoneNumber = defineRule({
  id: 'pii.phone',
  label: 'Phone Number',
  description: 'Phone numbers written in international or dashed format',
  token: 'PHONE',
  tier: 'low',
  pattern:
    /(?:\+[1-9]\d{7,14}\b|\(\d{3}\)[ -]?\d{3}[- ]?\d{4}\b|\b\d{3}[-.]\d{3}[-.]\d{4}\b)/g,
});

/** Area/group/serial blocks that the SSA never issues. */
function isPlausibleSsn(value: string): boolean {
  const digits = value.replace(/-/g, '');
  const area = digits.slice(0, 3);
  const group = digits.slice(3, 5);
  const serial = digits.slice(5);

  if (area === '000' || area === '666' || area.startsWith('9')) return false;
  if (group === '00') return false;
  if (serial === '0000') return false;
  return true;
}

/**
 * US Social Security Number, hyphenated form only.
 *
 * Default-on despite being soft PII: the hyphenated 3-2-4 shape is specific,
 * and the harm from leaking one is high enough that a rare false suggestion is
 * a good trade. It only ever suggests — it cannot block a prompt.
 */
export const socialSecurityNumber = defineRule({
  id: 'pii.ssn',
  label: 'Social Security Number',
  description: 'US Social Security Numbers in 000-00-0000 format',
  token: 'SSN',
  tier: 'low',
  pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  validate: (value) => isPlausibleSsn(value),
});

/**
 * Rejects dotted quads that are really version strings.
 *
 * `0.0.2.3` is this project's own version and a syntactically valid IPv4
 * address; there is no way to tell them apart from shape alone. Version
 * strings appear in prompts constantly and private IPs rarely, so the rule
 * errs toward silence: any quad whose octets are all single digits is treated
 * as a version. That loses `8.8.8.8` and `1.2.3.4`, neither of which is
 * sensitive.
 */
function isPlausibleIpv4(value: string, ctx: MatchContext): boolean {
  const octets = value.split('.').map((o) => Number.parseInt(o, 10));
  if (octets.some((o) => Number.isNaN(o) || o > 255)) return false;
  if (octets.every((o) => o < 10)) return false;

  if (value === '0.0.0.0' || value === '127.0.0.1' || value === '255.255.255.255') {
    return false;
  }

  // `v1.2.3.4`, `version 1.2.3.4` — explicit version markers.
  const before = ctx.text.slice(Math.max(0, ctx.start - 12), ctx.start).toLowerCase();
  if (/(?:^|[\s(])v$/.test(before) || before.includes('version')) return false;

  return true;
}

export const ipv4Address = defineRule({
  id: 'pii.ipv4',
  label: 'IP Address',
  description: 'IP addresses. Off by default: version numbers look identical',
  token: 'IP_ADDRESS',
  tier: 'low',
  pattern: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
  validate: isPlausibleIpv4,
});

/** Hostnames on suffixes that only exist inside a private network. */
export const internalHostname = defineRule({
  id: 'pii.internal_hostname',
  label: 'Internal Hostname',
  description: 'Hostnames ending .internal, .corp or .lan that reveal private infrastructure',
  token: 'INTERNAL_HOST',
  tier: 'low',
  pattern:
    /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:internal|intranet|corp|lan|local|localdomain|home\.arpa)\b/gi,
});

/**
 * US-style street address.
 *
 * The noisiest rule in the project and default-off accordingly. Kept because
 * the alternative for users handling client data is nothing at all.
 */
export const streetAddress = defineRule({
  id: 'pii.street_address',
  label: 'Street Address',
  description: 'US-style street addresses. Off by default: the noisiest rule here',
  token: 'ADDRESS',
  tier: 'low',
  pattern:
    /\b\d{1,5}\s+(?:[A-Z][A-Za-z]*\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Terrace|Ter)\b\.?/g,
});

export const piiRules: readonly Rule[] = [
  emailAddress,
  phoneNumber,
  socialSecurityNumber,
  ipv4Address,
  internalHostname,
  streetAddress,
];

/**
 * Low-tier rules that ship disabled.
 *
 * These are the families where a suggestion would appear often enough to
 * become background noise. They stay available for users who want them, but
 * the default experience must feel quiet or it does not get kept.
 */
export const DEFAULT_DISABLED_RULE_IDS: readonly string[] = [
  ipv4Address.id,
  internalHostname.id,
  streetAddress.id,
];
