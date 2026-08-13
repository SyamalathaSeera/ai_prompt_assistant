import { describe, expect, it } from 'vitest';
import { detect } from '../engine';
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
  it.each(['+14155551234', '(415) 555-1234', '415-555-1234', '415.555.1234'])(
    'detects %s',
    (sample) => {
      expect(idsIn(`call ${sample} tomorrow`)).toContain('pii.phone');
    },
  );

  it('ignores a bare ten-digit run, which could be any identifier', () => {
    expect(idsIn('order 4155551234 shipped')).not.toContain('pii.phone');
  });

  it('ignores a version string', () => {
    expect(idsIn('upgraded to 19.2.4 today')).not.toContain('pii.phone');
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
