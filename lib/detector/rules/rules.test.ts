import { describe, expect, it } from 'vitest';
import { detect } from '../engine';
import { ALL_RULES } from './index';

/**
 * High-tier rule tests.
 *
 * Every fixture below is a published documentation example or an obviously
 * synthetic value. Never commit a real credential here, even a revoked one —
 * this file is public the moment the repo is.
 *
 * The negative cases matter more than the positives. A missed secret is one
 * leak; a rule that fires on ordinary code annoys the user on every prompt and
 * gets the extension uninstalled. That asymmetry is why the high tier exists.
 */

/** Rule ids fired by scanning `text` with the real registry. */
function idsIn(text: string): string[] {
  return [...new Set(detect(text, {}, ALL_RULES).map((f) => f.ruleId))].sort();
}

describe('AWS', () => {
  // AWS's own documentation example key.
  const accessKey = 'AKIAIOSFODNN7EXAMPLE';

  it('detects an access key id', () => {
    expect(idsIn(`aws key ${accessKey}`)).toContain('aws.access_key_id');
  });

  it('detects a temporary (ASIA) access key id', () => {
    expect(idsIn('ASIAY34FZKBOKMUTVV7A')).toContain('aws.access_key_id');
  });

  it('does not fire inside a longer token', () => {
    expect(idsIn(`XX${accessKey}XX`)).not.toContain('aws.access_key_id');
  });

  // Synthetic 40-character secret. Deliberately NOT AWS's documentation
  // example (`wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`) — that value ends in
  // EXAMPLEKEY and is correctly suppressed as a placeholder, which makes it
  // useless as a stand-in for a real credential.
  const secretKey = 'kR7vN2xQ9mL4pW8sT6yB3zA5cF1dG0hJ7nE4uV2q';

  it('detects a secret key when anchored on its key name', () => {
    expect(idsIn(`aws_secret_access_key = ${secretKey}`)).toContain(
      'aws.secret_access_key',
    );
  });

  it('redacts only the secret, leaving the key name as context', () => {
    const text = `aws_secret_access_key=${secretKey}`;
    const found = detect(text, {}, ALL_RULES).find(
      (f) => f.ruleId === 'aws.secret_access_key',
    );
    expect(found).toBeDefined();
    expect(text.slice(found!.start, found!.end)).toBe(secretKey);
  });

  it('does not fire on a bare 40-character base64 string with no key name', () => {
    expect(idsIn(`checksum ${secretKey} here`)).not.toContain('aws.secret_access_key');
  });

  it('suppresses AWS’s own documentation example secret', () => {
    // Users paste AWS docs constantly; flagging the published example would be
    // a false positive on a value that is not a credential at all.
    const text = 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    expect(idsIn(text)).toEqual([]);
  });
});

describe('Google', () => {
  it('detects an API key', () => {
    expect(idsIn('AIzaSyD-1234567890abcdefghijklmnopqrstu')).toContain('gcp.api_key');
  });

  it('does not fire on a shorter lookalike', () => {
    expect(idsIn('AIzaSyD-tooshort')).not.toContain('gcp.api_key');
  });
});

describe('vendor tokens', () => {
  it('detects an OpenAI key', () => {
    expect(idsIn('sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD')).toContain(
      'openai.api_key',
    );
  });

  it('detects an OpenAI project key', () => {
    expect(idsIn('sk-proj-abcdefghijklmnopqrstuvwxyz0123456789')).toContain(
      'openai.api_key',
    );
  });

  it('classifies an Anthropic key as Anthropic, not OpenAI', () => {
    const ids = idsIn('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(ids).toContain('anthropic.api_key');
    expect(ids).not.toContain('openai.api_key');
  });

  it('detects a GitHub classic token', () => {
    expect(idsIn(`ghp_${'a1B2c3D4e5'.repeat(3)}abcdef`)).toContain('github.token');
  });

  it('detects a GitHub fine-grained token', () => {
    expect(idsIn(`github_pat_${'a1B2c3D4e5'.repeat(6)}`)).toContain(
      'github.pat_fine_grained',
    );
  });

  it('detects a Slack token', () => {
    expect(idsIn('xoxb-123456789012-abcdefghijklmnop')).toContain('slack.token');
  });

  it('detects a Stripe live key', () => {
    expect(idsIn('sk_live_abcdefghijklmnopqrstuvwx')).toContain('stripe.live_key');
  });

  it('ignores a Stripe test key, which cannot move money', () => {
    expect(idsIn('sk_test_abcdefghijklmnopqrstuvwx')).not.toContain('stripe.live_key');
  });

  it('detects a SendGrid key', () => {
    expect(idsIn('SG.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz')).toContain(
      'sendgrid.api_key',
    );
  });
});

describe('private key material', () => {
  const block = [
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEAxxxxSYNTHETICxxxx',
    'AAAAB3NzaC1yc2EAAAADAQABAAABgQDsynthetic',
    '-----END RSA PRIVATE KEY-----',
  ].join('\n');

  it('detects a PEM block', () => {
    expect(idsIn(block)).toContain('crypto.pem_private_key');
  });

  it('redacts the whole block, not just the header', () => {
    const found = detect(block, {}, ALL_RULES).find(
      (f) => f.ruleId === 'crypto.pem_private_key',
    );
    expect(found).toBeDefined();
    const matched = block.slice(found!.start, found!.end);
    expect(matched).toContain('BEGIN RSA PRIVATE KEY');
    expect(matched).toContain('END RSA PRIVATE KEY');
    // The body is what actually matters — a header-only match would leak it.
    expect(matched).toContain('MIIEowIBAAKCAQEAxxxxSYNTHETICxxxx');
  });

  it('catches an unterminated key header', () => {
    expect(idsIn('-----BEGIN OPENSSH PRIVATE KEY-----\nMIIEowIBAAKC')).toContain(
      'crypto.pem_private_key_header',
    );
  });

  it('does not fire on a public key', () => {
    const pub = '-----BEGIN PUBLIC KEY-----\nMIIBIjAN\n-----END PUBLIC KEY-----';
    expect(idsIn(pub)).toEqual([]);
  });

  it('does not fire on a certificate', () => {
    const cert = '-----BEGIN CERTIFICATE-----\nMIIDdzCC\n-----END CERTIFICATE-----';
    expect(idsIn(cert)).toEqual([]);
  });
});

describe('connection strings', () => {
  it('detects a password in a postgres URI', () => {
    expect(idsIn('postgres://app:hunter2pass@db.internal:5432/orders')).toContain(
      'db.connection_string_password',
    );
  });

  it('redacts only the password, keeping scheme host and database', () => {
    const text = 'postgres://app:hunter2pass@db.internal:5432/orders';
    const found = detect(text, {}, ALL_RULES).find(
      (f) => f.ruleId === 'db.connection_string_password',
    );
    expect(found).toBeDefined();
    expect(text.slice(found!.start, found!.end)).toBe('hunter2pass');
  });

  it('detects a mongodb+srv password', () => {
    expect(idsIn('mongodb+srv://svc:p4ssw0rd@cluster0.example.mongodb.net/app')).toContain(
      'db.connection_string_password',
    );
  });

  it('does not fire on a connection string without credentials', () => {
    expect(idsIn('postgres://db.internal:5432/orders')).not.toContain(
      'db.connection_string_password',
    );
  });

  it('does not fire on an ordinary URL', () => {
    expect(idsIn('https://example.com/docs/getting-started')).toEqual([]);
  });
});

describe('configuration assignments', () => {
  it('detects a secret assignment', () => {
    expect(idsIn('STRIPE_SECRET_KEY=zR9xK2mQ7vL4nP8w')).toContain(
      'env.secret_assignment',
    );
  });

  it('detects an exported shell secret', () => {
    expect(idsIn('export DB_PASSWORD="zR9xK2mQ7vL4nP8w"')).toContain(
      'env.secret_assignment',
    );
  });

  it('redacts only the value', () => {
    const text = 'API_TOKEN=zR9xK2mQ7vL4nP8w';
    const found = detect(text, {}, ALL_RULES).find(
      (f) => f.ruleId === 'env.secret_assignment',
    );
    expect(found).toBeDefined();
    expect(text.slice(found!.start, found!.end)).toBe('zR9xK2mQ7vL4nP8w');
  });

  it('ignores a shell variable reference', () => {
    expect(idsIn('export API_TOKEN=$MY_TOKEN')).not.toContain('env.secret_assignment');
  });

  it('ignores a function call', () => {
    expect(idsIn('const token = getAuthToken()')).not.toContain('env.secret_assignment');
  });

  it('ignores a template placeholder', () => {
    expect(idsIn('API_TOKEN={{ vault_token }}')).not.toContain('env.secret_assignment');
  });

  it('ignores an obvious padding value', () => {
    expect(idsIn('PASSWORD=xxxxxxxxxxxx')).not.toContain('env.secret_assignment');
  });

  it('ignores a non-secret key name', () => {
    expect(idsIn('DATABASE_HOST=db.internal.example')).not.toContain(
      'env.secret_assignment',
    );
  });

  it('yields to the specific vendor rule when both match the same value', () => {
    // The common real case: a recognised vendor key inside a config
    // assignment. Both rules match the same span, and the user is far better
    // served by "Stripe Live Key" than by the generic "Secret in
    // Configuration".
    const ids = idsIn('STRIPE_SECRET_KEY=sk_live_abcdefghijklmnopqrstuvwx');
    expect(ids).toContain('stripe.live_key');
    expect(ids).not.toContain('env.secret_assignment');
  });

  it('still catches a config secret that matches no vendor pattern', () => {
    expect(idsIn('INTERNAL_SIGNING_SECRET=zR9xK2mQ7vL4nP8w')).toContain(
      'env.secret_assignment',
    );
  });
});

describe('JWT', () => {
  // jwt.io's published example token.
  const token =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

  it('detects a valid token', () => {
    expect(idsIn(token)).toContain('auth.jwt');
  });

  it('rejects three dot-separated runs whose header is not JSON', () => {
    expect(idsIn('eyJabcdefghij.klmnopqrstuv.wxyzabcd')).not.toContain('auth.jwt');
  });

  it('rejects a dotted path that merely looks similar', () => {
    expect(idsIn('com.example.application.service')).not.toContain('auth.jwt');
  });
});

describe('payment cards', () => {
  it('detects a Luhn-valid card number', () => {
    // Synthetic: Luhn-valid, Visa prefix, not a published test card.
    expect(idsIn('card 4539578763621486 on file')).toContain('financial.card_number');
  });

  it('detects a grouped card number', () => {
    expect(idsIn('4539 5787 6362 1486')).toContain('financial.card_number');
    expect(idsIn('4539-5787-6362-1486')).toContain('financial.card_number');
  });

  it('ignores a number that fails Luhn', () => {
    expect(idsIn('order 4539578763621468 shipped')).not.toContain(
      'financial.card_number',
    );
  });

  it('ignores a Luhn-valid number with no issuer prefix', () => {
    // 9-prefixed, passes Luhn, belongs to no card scheme.
    expect(idsIn('reference 9999999999999995 logged')).not.toContain(
      'financial.card_number',
    );
  });

  it.each([
    ['4111111111111111', 'Visa'],
    ['4242424242424242', 'Stripe Visa'],
    ['5555555555554444', 'Mastercard'],
    ['378282246310005', 'Amex'],
  ])('ignores the published %s test card (%s)', (card) => {
    // These appear in documentation and test suites constantly. Flagging one
    // is a pure false positive.
    expect(idsIn(`use ${card} for testing`)).not.toContain('financial.card_number');
  });

  it('ignores a long digit run such as a timestamp or id', () => {
    expect(idsIn('epoch 1786584131049 recorded')).not.toContain('financial.card_number');
  });
});

describe('documentation placeholders are never flagged', () => {
  it.each([
    'OPENAI_API_KEY=sk-your-openai-key-here',
    'AWS_SECRET_ACCESS_KEY=<your-secret-access-key>',
    'DATABASE_URL=postgres://user:changeme@localhost:5432/db',
    'STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxxxxxxxxxxxxx',
    'API_TOKEN=YOUR_API_KEY',
  ])('stays silent on %s', (sample) => {
    expect(idsIn(sample)).toEqual([]);
  });
});

describe('redaction is idempotent', () => {
  /** Applies placeholders right-to-left, the same order redact() will use. */
  function applyPlaceholders(text: string): string {
    const found = detect(text, {}, ALL_RULES);
    return [...found]
      .sort((a, b) => b.start - a.start)
      .reduce(
        (acc, f) => acc.slice(0, f.start) + f.placeholder + acc.slice(f.end),
        text,
      );
  }

  it('finds nothing on a second pass over redacted text', () => {
    const original = [
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      'DATABASE_URL=postgres://app:s3cr3tP4ss@db.internal:5432/orders',
      'STRIPE_SECRET_KEY=sk_live_abcdefghijklmnopqrstuvwx',
      'card 4539578763621486',
    ].join('\n');

    const redacted = applyPlaceholders(original);

    expect(detect(original, {}, ALL_RULES).length).toBeGreaterThan(0);
    expect(detect(redacted, {}, ALL_RULES)).toEqual([]);
  });

  it('leaves the surrounding structure intact', () => {
    const redacted = applyPlaceholders('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE');
    expect(redacted).toBe('AWS_ACCESS_KEY_ID=[REDACTED_AWS_ACCESS_KEY_ID_1]');
  });
});

describe('negative corpus: ordinary developer text must stay silent', () => {
  const cleanSamples: Record<string, string> = {
    'plain prose': 'Can you help me refactor this function to be more readable?',
    'a git SHA': 'reverted in 9f2b1c4d8e6a0b3c5d7e9f1a2b4c6d8e0f2a4b6c',
    'a UUID': 'request id 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed',
    'a semver list': 'react@19.2.4, typescript@5.9.3, vitest@4.1.10',
    'an import block': "import { defineConfig } from 'wxt';",
    'a stack trace line': '  at Object.<anonymous> (/app/src/index.ts:42:15)',
    'a base64 image prefix': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
    'a hex colour list': 'palette: #1a1a1a #f5f5f5 #3b82f6 #ef4444',
    'a public URL': 'see https://docs.example.com/api/v2/reference for details',
    'an npm command': 'npm install --save-dev eslint prettier typescript',
    'a SQL query': 'SELECT id, email FROM users WHERE created_at > NOW() - 7',
    'an env var reference': 'process.env.NODE_ENV === "production"',
    'a docker image ref': 'FROM node:24-alpine AS builder',
    'a file path': 'C:\\Users\\dev\\project\\src\\components\\Button.tsx',
    'ordinary numbers': 'we processed 1234567890123456 records last quarter',
    'a lorem paragraph':
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.',
  };

  for (const [name, sample] of Object.entries(cleanSamples)) {
    it(`stays silent on ${name}`, () => {
      expect(idsIn(sample)).toEqual([]);
    });
  }
});

describe('realistic multi-secret document', () => {
  const dotenv = [
    '# production config',
    'NODE_ENV=production',
    'DATABASE_URL=postgres://app:s3cr3tP4ss@db.internal:5432/orders',
    'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
    'STRIPE_SECRET_KEY=sk_live_abcdefghijklmnopqrstuvwx',
    'LOG_LEVEL=debug',
  ].join('\n');

  it('finds every planted secret', () => {
    const ids = idsIn(dotenv);
    expect(ids).toContain('db.connection_string_password');
    expect(ids).toContain('aws.access_key_id');
    expect(ids).toContain('stripe.live_key');
  });

  it('leaves the non-secret lines alone', () => {
    const found = detect(dotenv, {}, ALL_RULES);
    const spans = found.map((f) => dotenv.slice(f.start, f.end));
    expect(spans.join(' ')).not.toContain('production');
    expect(spans.join(' ')).not.toContain('debug');
  });

  it('classifies the credentials as blocking and the hostname as advisory', () => {
    const found = detect(dotenv, {}, ALL_RULES);

    // Everything that can hold up a submission must be an actual credential.
    const high = found.filter((f) => f.tier === 'high').map((f) => f.ruleId);
    expect(high.sort()).toEqual([
      'aws.access_key_id',
      'db.connection_string_password',
      'stripe.live_key',
    ]);

    // `db.internal` is a genuine internal hostname, but leaking a hostname is
    // not worth interrupting someone over — advisory only, and off by default.
    const low = found.filter((f) => f.tier === 'low').map((f) => f.ruleId);
    expect(low).toEqual(['pii.internal_hostname']);
  });
});
