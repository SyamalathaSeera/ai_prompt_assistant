import type { PositiveCase } from './types';

/**
 * Positive corpus: realistic documents with planted synthetic secrets.
 *
 * Every value here is fabricated. Structurally valid so the detector exercises
 * real code paths, but belonging to no account anywhere. Never replace one
 * with a real credential, revoked or not — this file is public the moment the
 * repository is.
 */

const PEM_BLOCK = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEpAIBAAKCAQEA3Tz2mrSYNTHETICkeymaterialNOTREALdoNotUse0000',
  'ZmFrZWtleWJvZHlmb3J0ZXN0aW5ncHVycG9zZXNvbmx5bm90aGluZ3JlYWw9',
  '-----END RSA PRIVATE KEY-----',
].join('\n');

export const POSITIVE_CASES: readonly PositiveCase[] = [
  {
    name: 'production .env file',
    kind: 'config',
    text: [
      '# production — do not commit',
      'NODE_ENV=production',
      'PORT=8080',
      'DATABASE_URL=postgres://orders_app:Tq7ZmW2rKp9x@db-primary.internal:5432/orders',
      'AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7',
      'AWS_SECRET_ACCESS_KEY=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',
      'STRIPE_SECRET_KEY=sk_live_9mQ4vX2nR7tK1pL5wZ8yB3cF',
      'LOG_LEVEL=info',
    ].join('\n'),
    secrets: [
      { value: 'Tq7ZmW2rKp9x', ruleId: 'db.connection_string_password' },
      { value: 'AKIA3TZ2MRSYNTHETIC7', ruleId: 'aws.access_key_id' },
      {
        value: 'kR7vN2xQ9mL4pW8sT6yB3zA5cF1dG0hJ7nE4uV2q',
        ruleId: 'aws.secret_access_key',
      },
      { value: 'sk_live_9mQ4vX2nR7tK1pL5wZ8yB3cF', ruleId: 'stripe.live_key' },
    ],
  },

  {
    name: 'stack trace pasted for debugging',
    kind: 'stack trace',
    text: [
      'Getting this on deploy, any ideas?',
      '',
      'SequelizeConnectionError: password authentication failed',
      '    at Client._connectionCallback (/app/node_modules/pg/lib/client.js:132:24)',
      '    at Connection.<anonymous> (/app/node_modules/pg/lib/connection.js:88:11)',
      '  config: {',
      "    url: 'postgres://svc_reporting:Hn4LpQ8wTz2m@analytics.internal:5432/warehouse',",
      '    poolSize: 20',
      '  }',
    ].join('\n'),
    secrets: [{ value: 'Hn4LpQ8wTz2m', ruleId: 'db.connection_string_password' }],
  },

  {
    name: 'docker-compose with inline credentials',
    kind: 'config',
    text: [
      'services:',
      '  api:',
      '    image: registry.example.com/api:1.4.2',
      '    environment:',
      '      DATABASE_PASSWORD: Rw8kN3qLm6Zt',
      '      GITHUB_TOKEN: ghp_9mQ4vX2nR7tK1pL5wZ8yB3cF6dH0jS4aE7gU',
      '    ports:',
      '      - "8080:8080"',
    ].join('\n'),
    secrets: [
      { value: 'Rw8kN3qLm6Zt', ruleId: 'env.secret_assignment' },
      {
        value: 'ghp_9mQ4vX2nR7tK1pL5wZ8yB3cF6dH0jS4aE7gU',
        ruleId: 'github.token',
      },
    ],
  },

  {
    name: 'CI workflow with a leaked token',
    kind: 'ci config',
    text: [
      'name: deploy',
      'on: [push]',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - run: npm ci && npm test',
      '        env:',
      '          SLACK_WEBHOOK_TOKEN: xoxb-482910385721-Kp9xTq7ZmW2rN4vL',
      '          NPM_TOKEN: npm_Zt6mLq3Nk8wR2vX9yB4cF7dH1jS5aE0gU',
    ].join('\n'),
    secrets: [
      { value: 'xoxb-482910385721-Kp9xTq7ZmW2rN4vL', ruleId: 'slack.token' },
      {
        value: 'npm_Zt6mLq3Nk8wR2vX9yB4cF7dH1jS5aE0gU',
        ruleId: 'env.secret_assignment',
      },
    ],
  },

  {
    name: 'private key pasted into chat',
    kind: 'key material',
    text: `Can you tell me why ssh is rejecting this key?\n\n${PEM_BLOCK}\n\nIt worked yesterday.`,
    secrets: [{ value: PEM_BLOCK, ruleId: 'crypto.pem_private_key' }],
  },

  {
    name: 'API integration question with a live key',
    kind: 'prose',
    text: [
      'I am calling the completions endpoint with this key and getting a 401:',
      '',
      'curl https://api.openai.com/v1/chat/completions \\',
      '  -H "Authorization: Bearer sk-proj-Kp9xTq7ZmW2rN4vLZt6mLq3Nk8wR2vX9yB4cF7dH" \\',
      '  -d \'{"model":"gpt-4"}\'',
      '',
      'What am I doing wrong?',
    ].join('\n'),
    secrets: [
      {
        value: 'sk-proj-Kp9xTq7ZmW2rN4vLZt6mLq3Nk8wR2vX9yB4cF7dH',
        ruleId: 'openai.api_key',
      },
    ],
  },

  {
    name: 'session token in a bug report',
    kind: 'auth artifact',
    text: [
      'The refresh flow fails intermittently. Here is the token from the failing request:',
      '',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzkxODIiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3ODY1ODQxMzF9.Kp9xTq7ZmW2rN4vLZt6mLq3Nk8wR2vX9yB4cF7dH0j',
      '',
      'Expired tokens should return 401, not 500.',
    ].join('\n'),
    secrets: [
      {
        value:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzkxODIiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3ODY1ODQxMzF9.Kp9xTq7ZmW2rN4vLZt6mLq3Nk8wR2vX9yB4cF7dH0j',
        ruleId: 'auth.jwt',
      },
    ],
  },

  {
    name: 'customer record in a support thread',
    kind: 'pii',
    text: [
      'Customer says checkout fails every time.',
      '',
      'Account: sarah.chen@northwind-labs.io',
      'Phone: +14155559182',
      'Card on file ending 1486 — full number 4539578763621486',
      '',
      'Can you check the payment logs?',
    ].join('\n'),
    secrets: [
      { value: 'sarah.chen@northwind-labs.io', ruleId: 'pii.email' },
      { value: '+14155559182', ruleId: 'pii.phone' },
      { value: '4539578763621486', ruleId: 'financial.card_number' },
    ],
  },

  {
    name: 'terraform variables',
    kind: 'infrastructure',
    text: [
      'variable "region" {',
      '  default = "us-east-1"',
      '}',
      '',
      'provider "aws" {',
      '  access_key = "AKIA7NE4UV2QSYNTHET1"',
      '  secret_key = "wR2vX9yB4cF7dH1jS5aE0gUKp9xTq7ZmW2rN4vL8"',
      '}',
    ].join('\n'),
    secrets: [
      { value: 'AKIA7NE4UV2QSYNTHET1', ruleId: 'aws.access_key_id' },
      // Terraform names this `secret_key`, not `aws_secret_access_key`, so the
      // AWS-specific rule does not anchor on it and the generic
      // secret-assignment rule is what catches it. Still redacted, which is
      // what matters.
      {
        value: 'wR2vX9yB4cF7dH1jS5aE0gUKp9xTq7ZmW2rN4vL8',
        ruleId: 'env.secret_assignment',
      },
    ],
  },

  {
    name: 'kubernetes secret manifest',
    kind: 'infrastructure',
    text: [
      'apiVersion: v1',
      'kind: Secret',
      'metadata:',
      '  name: api-credentials',
      'stringData:',
      // SendGrid's real format is SG.<22 chars>.<43 chars>. An earlier draft of
      // this fixture used an 18-character middle segment, which the rule
      // correctly declined — the fixture was wrong, not the rule.
      '  SENDGRID_API_KEY: SG.Kp9xTq7ZmW2rN4vLZt6mLq.3Nk8wR2vX9yB4cF7dH1jS5aE0gUyT4mQ8xW2nR7v',
      '  DB_PASSWORD: Zt6mLq3Nk8wR',
    ].join('\n'),
    secrets: [
      {
        value: 'SG.Kp9xTq7ZmW2rN4vLZt6mLq.3Nk8wR2vX9yB4cF7dH1jS5aE0gUyT4mQ8xW2nR7v',
        ruleId: 'sendgrid.api_key',
      },
      { value: 'Zt6mLq3Nk8wR', ruleId: 'env.secret_assignment' },
    ],
  },
];
