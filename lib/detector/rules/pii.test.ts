import { describe, expect, it } from 'vitest';
import { detect, redact } from '../engine';
import { DEFAULT_SETTINGS } from '../../policy/defaults';
import { ALL_RULES, DEFAULT_DISABLED_RULE_IDS } from './index';
import { piiRules } from './pii';

/**
 * Low-tier PII tests.
 *
 * Two properties matter more than any individual pattern: these rules must
 * never be high tier (they must not be able to block a prompt), and the
 * default-on set must stay quiet on ordinary text.
 */

function idsIn(text: string, options = {}): string[] {
  return [...new Set(detect(text, options, ALL_RULES).map((f) => f.ruleId))].sort();
}

/** Scans with the shipped defaults, i.e. what a new user actually experiences. */
function idsWithDefaults(text: string): string[] {
  return idsIn(text, { disabledRuleIds: DEFAULT_SETTINGS.disabledRuleIds });
}

describe('tier discipline', () => {
  it('every PII rule is low tier and therefore cannot block submission', () => {
    expect(piiRules.every((r) => r.tier === 'low')).toBe(true);
  });

  it('no rule detects person names', () => {
    // Names without an NER model means matching capitalised words, which fires
    // on every proper noun and gets the extension uninstalled.
    const ids = idsIn('Ask Priya Raman and Dr. Marcus Webb about the Q3 review');
    expect(ids).toEqual([]);
  });
});

describe('email', () => {
  it('detects a real-looking address', () => {
    expect(idsIn('write to sarah.chen@northwind-labs.io about it')).toContain(
      'pii.email',
    );
  });

  it('ignores documentation domains', () => {
    expect(idsIn('contact user@example.com for details')).not.toContain('pii.email');
    expect(idsIn('admin@yourdomain.com')).not.toContain('pii.email');
  });

  it('ignores a scoped npm package', () => {
    expect(idsIn('install @anthropic-ai/sdk and react@19.2.4')).not.toContain(
      'pii.email',
    );
  });
});

describe('phone', () => {
  it.each([
    '+14155551234',
    '(415) 555-1234',
    '415-555-1234',
    '415.555.1234',
    // Spaces are separators too. Their absence used to lose most of the
    // world's phone numbers, including every international one written the
    // way people actually write them.
    '415 555 1234',
    '+1 415 555 1234',
    '+44 20 7946 0958',
    '+91 98765 43210',
  ])('detects %s', (sample) => {
    expect(idsIn(`call ${sample} tomorrow`)).toContain('pii.phone');
  });

  it.each(['+1-415-555-1234', '+1 415 555 1234', '+44 20 7946 0958', '415 555 1234'])(
    'redacts %s whole, country code included',
    (sample) => {
      /*
       * The bug this was written for: the country code fell outside the match,
       * so `+1-415-555-1234` redacted to `+1-[REDACTED_PHONE_1]` while the UI
       * reported a clean catch. A partial redaction that claims success is
       * worse than a miss — the user has been told they are safe.
       */
      const text = `call ${sample} tomorrow`;
      const redacted = redact(text, detect(text)).text;

      expect(redacted).toBe('call [REDACTED_PHONE_1] tomorrow');
      expect(redacted).not.toContain('+');
    },
  );

  it('catches a bare ten-digit run that is shaped like a real number', () => {
    /*
     * This rule used to refuse the shape outright as "indistinguishable from
     * an order number". Sound about the digits, wrong about prompts: typing
     * ten digits into a chat is overwhelmingly a phone number, and the one
     * format people type most often was the one getting no protection.
     */
    expect(idsIn('9247805478')).toContain('pii.phone');
    expect(idsIn('here is my number 9247805478')).toContain('pii.phone');
  });

  it('ignores a bare ten-digit run the text calls something else', () => {
    // What replaced the blanket refusal: read the word in front of it.
    for (const text of [
      'order 4155551234 shipped',
      'invoice 9247805478',
      'reference 9247805478',
      'ticket 9247805478',
      'account 9247805478',
      'sku 9247805478',
    ]) {
      expect(idsIn(text)).not.toContain('pii.phone');
    }
  });

  it('ignores ten-digit runs that cannot be North American numbers', () => {
    /*
     * With no word either way, shape decides. Area and central office codes
     * both begin 2-9 — a real rule, and one that happens to exclude the two
     * ten-digit runs that turn up most in prompts.
     */
    expect(idsIn('1755600000')).not.toContain('pii.phone'); // Unix seconds
    expect(idsIn('0306406152')).not.toContain('pii.phone'); // ISBN-10
    expect(idsIn('1234567890')).not.toContain('pii.phone');
  });

  it('lets an explicit phone word override the shape rule', () => {
    // Numbers outside North America follow no shape we can check, so a person
    // saying what it is outranks our heuristic.
    expect(idsIn('phone: 1234567890')).toContain('pii.phone');
  });

  it('ignores a version string', () => {
    expect(idsIn('upgraded to 19.2.4 today')).not.toContain('pii.phone');
  });

  it('ignores three columns of figures', () => {
    // The cost of accepting spaces as separators: `NNN NNN NNNN` is also what
    // a row of numbers looks like. No area code begins with 0 or 1, which is
    // enough to tell them apart.
    expect(idsIn('run 100 200 3000 iterations')).not.toContain('pii.phone');
    expect(idsIn('sizes 100 250 5000 respectively')).not.toContain('pii.phone');
  });
});

describe('SSN', () => {
  it('detects a plausible number', () => {
    expect(idsIn('SSN 123-45-6789 on file')).toContain('pii.ssn');
  });

  it.each(['000-45-6789', '666-45-6789', '900-45-6789', '123-00-6789', '123-45-0000'])(
    'ignores %s, which the SSA never issues',
    (sample) => {
      expect(idsIn(sample)).not.toContain('pii.ssn');
    },
  );

  it('is on by default, since the shape is specific and the harm is high', () => {
    expect(DEFAULT_SETTINGS.disabledRuleIds).not.toContain('pii.ssn');
  });
});

describe('IPv4', () => {
  const enabled = { disabledRuleIds: [] };

  it('detects a private address when enabled', () => {
    expect(idsIn('host 192.168.10.42 refused', enabled)).toContain('pii.ipv4');
  });

  it('rejects an out-of-range octet', () => {
    expect(idsIn('999.1.1.1', enabled)).not.toContain('pii.ipv4');
  });

  it('does not mistake this project’s own version for an address', () => {
    // 0.0.2.3 is a syntactically valid IPv4 address. Version strings appear in
    // prompts constantly and single-digit-octet addresses are never sensitive,
    // so the rule stays silent on them.
    expect(idsIn('bumped to 0.0.2.3 today', enabled)).not.toContain('pii.ipv4');
  });

  it('ignores an explicitly marked version', () => {
    expect(idsIn('running v10.20.30.40 now', enabled)).not.toContain('pii.ipv4');
  });

  it.each(['0.0.0.0', '127.0.0.1', '255.255.255.255'])('ignores %s', (sample) => {
    expect(idsIn(`bind ${sample}`, enabled)).not.toContain('pii.ipv4');
  });
});

describe('internal hostnames', () => {
  const enabled = { disabledRuleIds: [] };

  it('detects an internal suffix when enabled', () => {
    expect(idsIn('deployed to api.payments.internal', enabled)).toContain(
      'pii.internal_hostname',
    );
  });

  it('ignores a public hostname', () => {
    expect(idsIn('fetch from api.github.com', enabled)).not.toContain(
      'pii.internal_hostname',
    );
  });
});

describe('shipped defaults stay quiet', () => {
  it('disables exactly the noisy families', () => {
    expect([...DEFAULT_DISABLED_RULE_IDS].sort()).toEqual([
      'pii.internal_hostname',
      'pii.ipv4',
      'pii.street_address',
    ]);
  });

  it('keeps defaults sourced from the rule definitions', () => {
    expect(DEFAULT_SETTINGS.disabledRuleIds).toEqual([...DEFAULT_DISABLED_RULE_IDS]);
  });

  it.each([
    'deploy to 10.0.1.55 after the migration',
    'the box at db-primary.corp resolves fine',
    'ship it to 1600 Pennsylvania Avenue',
  ])('stays silent on %s with default settings', (sample) => {
    expect(idsWithDefaults(sample)).toEqual([]);
  });

  it('still reports email and phone by default', () => {
    const ids = idsWithDefaults('reach sarah.chen@northwind-labs.io or +14155551234');
    expect(ids).toContain('pii.email');
    expect(ids).toContain('pii.phone');
  });
});

describe('mixed document', () => {
  it('separates blocking secrets from advisory PII', () => {
    const text = [
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      'support contact: sarah.chen@northwind-labs.io',
    ].join('\n');

    const found = detect(text, { disabledRuleIds: DEFAULT_SETTINGS.disabledRuleIds }, ALL_RULES);
    const high = found.filter((f) => f.tier === 'high').map((f) => f.ruleId);
    const low = found.filter((f) => f.tier === 'low').map((f) => f.ruleId);

    expect(high).toEqual(['aws.access_key_id']);
    expect(low).toEqual(['pii.email']);
  });
});

describe('numbers named rather than formatted', () => {
  /*
   * The gap this closes: someone typing carefully enough to write "ssn" in
   * front of their number was getting less protection than someone who
   * happened to punctuate it, because the rules only ever read shape.
   *
   * A bare run of digits stays refused on its own — it is equally an order
   * number — so the label is what buys the loose shape its precision back.
   */

  it.each([
    'ssn 784523789',
    'SSN: 784523789',
    'my ssn is 784523789',
    'social security number 784523789',
    'social security 784523789',
    'ss# 784523789',
  ])('detects an unformatted SSN in "%s"', (text) => {
    expect(idsIn(text)).toContain('pii.ssn');
  });

  it.each(['ssn 784 52 3789', 'ssn 784.52.3789'])(
    'detects a differently separated SSN in "%s"',
    (text) => {
      expect(idsIn(text)).toContain('pii.ssn');
    },
  );

  it.each(['order 784523789 shipped', 'invoice 784523789', 'build 123456789 passed'])(
    'stays silent on nine digits nobody called an SSN: "%s"',
    (text) => {
      expect(idsIn(text)).not.toContain('pii.ssn');
    },
  );

  it('still rejects a number the SSA could never have issued, even when labelled', () => {
    // The label says what it is; it does not make it real. Both routes run
    // through the same plausibility check.
    expect(idsIn('ssn 000456789')).not.toContain('pii.ssn');
    expect(idsIn('ssn 666456789')).not.toContain('pii.ssn');
  });

  it.each([
    'call me on 4155551234',
    'phone: 4155551234',
    'my number is 4155551234',
    'mobile 4155551234',
    'contact 4155551234 tomorrow',
  ])('detects an unformatted phone number in "%s"', (text) => {
    expect(idsIn(text)).toContain('pii.phone');
  });

  it.each([
    'order 4155551234 shipped',
    'transaction 4155551234',
    'the row id 1234567890 is wrong',
  ])('stays silent on ten digits nobody called a number: "%s"', (text) => {
    expect(idsIn(text)).not.toContain('pii.phone');
  });

  it('reads only the words immediately before the number', () => {
    /*
     * The lookback is deliberately short. A label belonging to an earlier
     * sentence is not a label for this number, and a window wide enough to
     * catch one would turn any paragraph mentioning an SSN into a paragraph
     * where every nine-digit run is an SSN.
     */
    const far = 'ssn on file, and separately the batch identifier 784523789';
    expect(idsIn(far)).not.toContain('pii.ssn');
  });

  it('redacts the number and not the word naming it', () => {
    const text = 'ssn 784523789';
    const redacted = redact(text, detect(text)).text;

    expect(redacted).toBe('ssn [REDACTED_SSN_1]');
  });
});
