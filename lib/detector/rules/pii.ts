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
 * How far back to look for a word saying what a number is.
 *
 * Long enough for "social security number:" and no longer. A wider window
 * starts picking up labels belonging to an earlier sentence.
 */
const LABEL_LOOKBACK = 32;

/** Trailing connectors between a label and its value: `ssn: `, `my ssn is `. */
const LABEL_TAIL = String.raw`(?:\s+(?:is|was|are))?[\s:=#-]*$`;

/**
 * Whether the text immediately before a match says what the number is.
 *
 * This is the mechanism that makes the format-strict rules below survive a
 * user who types their own way. A bare run of digits is genuinely ambiguous —
 * it is equally an order number, an invoice, a row id — so matching one on
 * shape alone is the noise this file already refuses. But `ssn 784523789` is
 * not ambiguous at all: the user has said what it is. The shape rules stay
 * strict, and the label is what buys the loose ones their precision back.
 *
 * `pii.ipv4` already reads context this way to tell an address from a version
 * string; this is the same idea pointed the other direction.
 */
function hasLabelBefore(ctx: MatchContext, label: RegExp): boolean {
  const before = ctx.text
    .slice(Math.max(0, ctx.start - LABEL_LOOKBACK), ctx.start)
    .toLowerCase();
  return label.test(before);
}

/**
 * Phone numbers in E.164 or common separator-delimited form.
 *
 * A bare run of ten digits is still not matched: it is indistinguishable from
 * an order number, and the noise would swamp the real hits. Everything else
 * here needs at least one separator or a country code to qualify.
 *
 * Two things the first version got wrong, both found by using it:
 *
 * **Spaces were not separators.** Only `-` and `.` were, so `555 123 4567`
 * was missed, and so was every international number written the way people
 * actually write them — `+1 555 123 4567`, `+44 20 7946 0958`,
 * `+91 98765 43210`. The E.164 branch demanded unbroken digits, so the `+`
 * did not help. That is most of the world's phone numbers.
 *
 * **The country code was left behind.** `+1-555-123-4567` matched only its
 * last twelve characters, so redaction produced `+1-[REDACTED_PHONE_1]` while
 * the UI reported a clean catch. A partial redaction that claims success is
 * worse than a miss: the user has been told they are safe. The country code
 * is now part of the match, and `test/corpus` covers the shape.
 */
const PHONE_SEPARATOR = '[ .-]';
const COUNTRY_CODE = `\\+\\d{1,3}`;

/**
 * Rejects three columns of figures that happen to be shaped like a number.
 *
 * Allowing spaces as separators brought in one false positive worth naming:
 * `run 100 200 3000 iterations` is `NNN NNN NNNN` and matches on shape alone.
 *
 * A country code, brackets, a dash, or a dot is already a strong signal that
 * a human meant a phone number, so those pass untouched. What is left is the
 * bare spaced form, and there the leading digit settles it — no area code
 * anywhere begins with 0 or 1.
 *
 * The cost is a national number written the British or Indian way without its
 * country code (`020 7946 0958`), which is a real miss. Those are caught the
 * moment a `+` is present, and the alternative — flagging any three columns of
 * figures — is the noise this rule already refuses for bare ten-digit runs.
 */
function isPlausiblePhone(value: string): boolean {
  if (/[+().-]/.test(value)) return true;
  return /^[2-9]/.test(value);
}

/**
 * Words that say a run of digits is something other than a phone number.
 *
 * The inverse of the label check, and the thing that makes catching bare
 * digits affordable. The rule used to refuse `9247805478` outright on the
 * grounds that it is indistinguishable from an order number — true in the
 * abstract, and wrong in practice, because a prompt that means an order
 * number almost always says so. Reading the word in front is a better
 * discriminator than refusing the whole shape.
 */
const NOT_A_PHONE_LABEL = new RegExp(
  String.raw`(?:order|invoice|transaction|txn|receipt|account|acct|reference|ref|ticket|case|build|sku|upc|isbn|row|record|batch|job|run|id|no\.?|number)` +
    String.raw`(?:\s*(?:number|no\.?|#|id))?` +
    LABEL_TAIL,
);

/**
 * Whether ten bare digits could be a North American number at all.
 *
 * Area codes and central office codes both begin 2-9, which is a real rule
 * rather than a guess, and it happens to exclude the two ten-digit runs that
 * turn up most in prompts: a Unix timestamp in seconds (begins 1 until 2033)
 * and an ISBN-10 (usually begins 0). Anything a user explicitly labelled skips
 * this check, because numbers outside North America do not follow it.
 */
function looksLikeNanp(digits: string): boolean {
  return /^[2-9]\d{2}[2-9]/.test(digits);
}

/** Words a person puts in front of their phone number. */
const PHONE_LABEL = new RegExp(
  String.raw`(?:(?:phone|tel(?:ephone)?|mobile|cell|fax|whats\s?app|contact)(?:\s*(?:number|no\.?|#))?` +
    String.raw`|(?:my|our|his|her|their)\s+(?:number|no\.?)` +
    String.raw`|call(?:\s+(?:me|us|him|her|them))?(?:\s+(?:on|at))?)` +
    LABEL_TAIL,
);

export const phoneNumber = defineRule({
  id: 'pii.phone',
  label: 'Phone Number',
  description: 'Phone numbers written in international, spaced, or dashed format',
  token: 'PHONE',
  tier: 'low',
  pattern: new RegExp(
    [
      // E.164, unbroken: +14155551234
      `${COUNTRY_CODE}\\d{6,13}\\b`,
      // International with separators: +44 20 7946 0958, +91 98765 43210
      `${COUNTRY_CODE}(?:${PHONE_SEPARATOR}\\d{2,5}){2,4}\\b`,
      // National, optionally with a country code: +1-555-123-4567, (415) 555-1234
      `(?:${COUNTRY_CODE}${PHONE_SEPARATOR}?)?(?:\\(\\d{3}\\)${PHONE_SEPARATOR}?|\\b\\d{3}${PHONE_SEPARATOR})\\d{3}${PHONE_SEPARATOR}\\d{4}\\b`,
      // Unformatted, and admitted only when the text says what it is.
      `\\b\\d{10}\\b`,
    ].join('|'),
    'g',
  ),
  validate: (value, ctx) => {
    /*
     * A bare ten-digit run, decided in three steps.
     *
     * This rule used to refuse the shape outright, on the grounds that it is
     * indistinguishable from an order number. That reasoning is sound about
     * the digits and wrong about prompts: someone typing `9247805478` into a
     * chat has almost always typed a phone number, and someone typing an
     * order number almost always writes the word "order" next to it. Refusing
     * the shape meant the one format people type most often was the one
     * format that got no protection at all.
     *
     * So: an explicit phone word admits it whatever it looks like, since
     * numbers outside North America follow no shape we can check. An explicit
     * word for something else rejects it. With no word either way, the NANP
     * rule decides, which is what keeps timestamps and ISBNs out.
     */
    if (/^\d{10}$/.test(value)) {
      if (hasLabelBefore(ctx, PHONE_LABEL)) return true;
      if (hasLabelBefore(ctx, NOT_A_PHONE_LABEL)) return false;
      return looksLikeNanp(value);
    }

    // Every other shape carries a separator or a country code, and is judged
    // on that rather than on context.
    return isPlausiblePhone(value);
  },
});

/** Words a person puts in front of their social security number. */
const SSN_LABEL = new RegExp(
  String.raw`(?:ssn|ss\s?#|soc(?:ial)?\s*sec(?:urity)?(?:\s*(?:number|no\.?|#))?)` +
    LABEL_TAIL,
);

/** Area/group/serial blocks that the SSA never issues. */
function isPlausibleSsn(value: string): boolean {
  const digits = value.replace(/[- .]/g, '');
  if (digits.length !== 9) return false;

  const area = digits.slice(0, 3);
  const group = digits.slice(3, 5);
  const serial = digits.slice(5);

  if (area === '000' || area === '666' || area.startsWith('9')) return false;
  if (group === '00') return false;
  if (serial === '0000') return false;
  return true;
}

/**
 * US Social Security Number, by shape or by label.
 *
 * **By shape.** `000-00-0000` and its spaced and dotted cousins. The 3-2-4
 * grouping is specific enough to stand on its own.
 *
 * **By label.** A bare `784523789` is not specific at all — it is equally an
 * account number, a row id, or a part code, and matching nine digits on sight
 * would bury the user in suggestions. But `ssn 784523789` says what it is, and
 * refusing to see that was the rule failing the one user careful enough to
 * name it. See `hasLabelBefore`.
 *
 * Both paths still go through `isPlausibleSsn`, so a number the SSA could
 * never have issued is rejected however it was written.
 *
 * Default-on despite being soft PII: both paths are specific, and the harm
 * from leaking one is high enough that a rare false suggestion is a good
 * trade. It only ever suggests — it cannot block a prompt.
 */
export const socialSecurityNumber = defineRule({
  id: 'pii.ssn',
  label: 'Social Security Number',
  description: 'US Social Security Numbers, formatted or labelled',
  token: 'SSN',
  tier: 'low',
  pattern: /\b\d{3}[- .]\d{2}[- .]\d{4}\b|\b\d{9}\b/g,
  validate: (value, ctx) => {
    if (!isPlausibleSsn(value)) return false;
    // The hyphenated form is specific on its own. Everything else has to be
    // told what it is.
    if (/^\d{3}-\d{2}-\d{4}$/.test(value)) return true;
    return hasLabelBefore(ctx, SSN_LABEL);
  },
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
