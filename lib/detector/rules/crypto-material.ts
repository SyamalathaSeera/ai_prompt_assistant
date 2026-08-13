import { defineRule } from './shared';
import type { Rule } from '../types';

/**
 * Private key material.
 *
 * These rules deliberately match the ENTIRE armoured block, header through
 * footer, not just the `-----BEGIN` line. Matching only the header would
 * redact the label and leave the key body sitting in the prompt — a redaction
 * that looks like it worked while leaking everything that matters.
 */

/**
 * PEM private keys: RSA, EC, DSA, OpenSSH, PGP, and unlabelled PKCS#8.
 * Non-greedy body so two adjacent blocks are matched separately.
 */
export const pemPrivateKey = defineRule({
  id: 'crypto.pem_private_key',
  label: 'Private Key Block',
  token: 'PRIVATE_KEY',
  // Placeholder heuristics target short values and say nothing useful about a
  // multi-line armoured block.
  skipPlaceholderCheck: true,
  pattern:
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
});

/**
 * An unterminated private key header.
 *
 * Someone pasting the first half of a key file still leaks key material, and
 * the block rule above requires a footer. This catches the header alone —
 * scoped to the rest of that line so it cannot swallow the document.
 */
export const pemPrivateKeyHeader = defineRule({
  id: 'crypto.pem_private_key_header',
  label: 'Private Key Header',
  token: 'PRIVATE_KEY',
  pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
});

/** PuTTY private key files, which use their own header format. */
export const puttyPrivateKey = defineRule({
  id: 'crypto.putty_private_key',
  label: 'PuTTY Private Key',
  token: 'PRIVATE_KEY',
  pattern: /PuTTY-User-Key-File-\d+:\s*\S+/g,
});

export const cryptoMaterialRules: readonly Rule[] = [
  pemPrivateKey,
  pemPrivateKeyHeader,
  puttyPrivateKey,
];
