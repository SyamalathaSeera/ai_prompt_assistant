import type { NegativeCase } from './types';

/**
 * Negative corpus: realistic text that must produce ZERO high-tier findings.
 *
 * This is the more important half of the corpus. A missed secret costs the
 * user one leak; a rule that fires on ordinary code interrupts them on every
 * single prompt, and that is what gets a tool like this uninstalled.
 *
 * Every false positive reported during beta (milestone 0.9.0.0) gets added
 * here before it is fixed, so the fix is regression-tested forever.
 */
export const NEGATIVE_CASES: readonly NegativeCase[] = [
  {
    name: 'ordinary TypeScript',
    kind: 'code',
    text: [
      'export function resolveAdapter(hostname: string): SiteAdapter | null {',
      '  const host = hostname.toLowerCase().replace(/^www\\./, "");',
      '  return ADAPTERS.find((a) => a.hosts.includes(host)) ?? null;',
      '}',
    ].join('\n'),
  },
  {
    name: 'API documentation with dummy keys',
    kind: 'docs',
    text: [
      '## Authentication',
      '',
      'Pass your key in the Authorization header:',
      '',
      '    curl -H "Authorization: Bearer sk-your-api-key-here" https://api.example.com/v1/me',
      '',
      'Set `API_TOKEN=<your-token>` in your environment before running.',
    ].join('\n'),
  },
  {
    name: 'git log output',
    kind: 'tooling',
    text: [
      'commit 9f2b1c4d8e6a0b3c5d7e9f1a2b4c6d8e0f2a4b6c',
      'Author: Dev <dev@example.com>',
      'Date:   Tue Aug 12 09:14:22 2026 -0400',
      '',
      '    Fix off-by-one in pagination',
    ].join('\n'),
  },
  {
    name: 'UUID list',
    kind: 'identifiers',
    text: [
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      '550e8400-e29b-41d4-a716-446655440000',
    ].join('\n'),
  },
  {
    name: 'base64 image data',
    kind: 'encoded data',
    text:
      'background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==);',
  },
  {
    name: 'minified javascript',
    kind: 'code',
    text: '!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?t(exports):"function"==typeof define&&define.amd?define(["exports"],t):t(e.lib={})}(this,function(e){"use strict";e.version="4.17.21"});',
  },
  {
    name: 'SQL schema',
    kind: 'code',
    text: [
      'CREATE TABLE users (',
      '  id BIGSERIAL PRIMARY KEY,',
      '  email TEXT NOT NULL UNIQUE,',
      '  password_hash TEXT NOT NULL,',
      '  created_at TIMESTAMPTZ DEFAULT NOW()',
      ');',
    ].join('\n'),
  },
  {
    name: 'package.json dependencies',
    kind: 'config',
    text: [
      '{',
      '  "dependencies": {',
      '    "react": "^19.2.4",',
      '    "react-dom": "^19.2.4"',
      '  },',
      '  "devDependencies": {',
      '    "typescript": "^5.9.3",',
      '    "vitest": "^4.1.10"',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    name: 'nginx configuration',
    kind: 'config',
    text: [
      'server {',
      '  listen 443 ssl;',
      '  server_name app.example.com;',
      '  ssl_certificate /etc/ssl/certs/app.pem;',
      '  location /api/ { proxy_pass http://127.0.0.1:8080; }',
      '}',
    ].join('\n'),
  },
  {
    name: 'application log lines',
    kind: 'logs',
    text: [
      '2026-08-12T09:14:22.481Z INFO  request completed status=200 duration=142ms',
      '2026-08-12T09:14:23.902Z WARN  cache miss key=user:91827364 ttl=300',
      '2026-08-12T09:14:24.118Z ERROR upstream timeout after 30000ms',
    ].join('\n'),
  },
  {
    name: 'markdown README',
    kind: 'docs',
    text: [
      '# Project',
      '',
      'A small utility for parsing logs.',
      '',
      '## Install',
      '',
      '```',
      'npm install --save log-parse',
      '```',
    ].join('\n'),
  },
  {
    name: 'CSS',
    kind: 'code',
    text: [
      ':root {',
      '  --bg: #0f172a;',
      '  --fg: #f8fafc;',
      '  --accent: #3b82f6;',
      '}',
      '.card { border-radius: 12px; padding: 1.25rem; }',
    ].join('\n'),
  },
  {
    name: 'shell script',
    kind: 'code',
    text: [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'export API_TOKEN="$VAULT_API_TOKEN"',
      'curl -fsSL "$ENDPOINT/health" | jq -r ".status"',
    ].join('\n'),
  },
  {
    name: 'test runner output',
    kind: 'tooling',
    text: [
      ' Test Files  6 passed (6)',
      '      Tests  181 passed (181)',
      '   Duration  445ms (transform 472ms, import 774ms)',
    ].join('\n'),
  },
  {
    name: 'JSON API response',
    kind: 'data',
    text: [
      '{',
      '  "id": 91827364,',
      '  "status": "active",',
      '  "created_at": "2026-08-12T09:14:22Z",',
      '  "quantity": 1234567890123456',
      '}',
    ].join('\n'),
  },
  {
    name: 'prose about security',
    kind: 'prose',
    text: [
      'We should rotate the production API keys quarterly and store them in the',
      'secrets manager rather than in environment files. The current password',
      'policy requires 16 characters minimum.',
    ].join('\n'),
  },
  {
    name: 'regex-heavy code',
    kind: 'code',
    text: [
      'const RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$/;',
      'const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;',
      'const SEMVER = /^\\d+\\.\\d+\\.\\d+(?:-[\\w.]+)?$/;',
    ].join('\n'),
  },
  {
    name: 'certificate block',
    kind: 'key material',
    text: [
      '-----BEGIN CERTIFICATE-----',
      'MIIDdzCCAl+gAwIBAgIEAgAAuTANBgkqhkiG9w0BAQUFADBaMQswCQYDVQQGEwJJ',
      'RTESMBAGA1UEChMJQmFsdGltb3JlMRMwEQYDVQQLEwpDeWJlclRydXN0',
      '-----END CERTIFICATE-----',
    ].join('\n'),
  },
  {
    name: 'public key block',
    kind: 'key material',
    text: [
      '-----BEGIN PUBLIC KEY-----',
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3Tz2mCnJdRhVvBqLpQ',
      '-----END PUBLIC KEY-----',
    ].join('\n'),
  },
  {
    name: 'docker build output',
    kind: 'tooling',
    text: [
      'FROM node:24-alpine AS builder',
      'WORKDIR /app',
      'COPY package*.json ./',
      'RUN npm ci --omit=dev',
      ' ---> Running in 4f8a2c1b9e7d',
      'Successfully built 7c9e66797425',
    ].join('\n'),
  },
  {
    name: 'lorem ipsum',
    kind: 'prose',
    text: [
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod',
      'tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam,',
      'quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo.',
    ].join('\n'),
  },
  {
    name: 'windows paths and versions',
    kind: 'tooling',
    text: [
      'C:\\Users\\dev\\project\\src\\components\\Button.tsx',
      'Installed 0.0.2.4 over 0.0.2.3 (assembly 1.0.0.0)',
      'Node v24.14.0, npm 11.9.0',
    ].join('\n'),
  },
  {
    name: 'order numbers and identifiers',
    kind: 'data',
    text: [
      'Order 1234567890123456 shipped on 2026-08-12.',
      'Tracking 9400111899223197428490, invoice INV-2026-004821.',
      'Reference 4155551234 in the ledger.',
    ].join('\n'),
  },
  {
    name: 'stripe test cards in documentation',
    kind: 'docs',
    text: [
      'Use these numbers in test mode:',
      '  4242 4242 4242 4242  — Visa, succeeds',
      '  4000 0000 0000 0002  — card declined',
      '  5555 5555 5555 4444  — Mastercard',
      '  3782 822463 10005    — American Express',
    ].join('\n'),
  },
];
