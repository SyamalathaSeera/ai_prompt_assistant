import { defineRule } from './shared';
import { hasEnoughDistinctCharacters, hasMixedCharacters } from '../validators';
import type { Rule } from '../types';

/**
 * Cloud provider credentials.
 *
 * All high tier: these have prefixes distinctive enough that a false positive
 * on ordinary text is close to impossible.
 */

/**
 * AWS access key id — `AKIA`/`ASIA`/`ABIA`/`ACCA` plus exactly 16 uppercase
 * alphanumerics. Word boundaries stop it matching inside a longer token.
 */
export const awsAccessKeyId = defineRule({
  id: 'aws.access_key_id',
  label: 'AWS Access Key ID',
  description: 'Keys beginning AKIA or ASIA that identify an AWS account',
  token: 'AWS_ACCESS_KEY_ID',
  pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
});

/**
 * AWS secret access key — 40 base64-ish characters.
 *
 * The value alone is indistinguishable from any other 40-character base64
 * string, so the rule anchors on the surrounding key name and redacts only the
 * captured value. Without that anchor this pattern would fire on checksums,
 * hashes, and encoded blobs constantly.
 */
export const awsSecretAccessKey = defineRule({
  id: 'aws.secret_access_key',
  label: 'AWS Secret Access Key',
  description: 'The secret half of an AWS key pair, when labelled as one',
  token: 'AWS_SECRET',
  pattern:
    /aws_secret_access_key\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
  captureGroup: 1,
  validate: (value) => hasMixedCharacters(value) && hasEnoughDistinctCharacters(value),
});

/**
 * Google API key — `AIza` plus 35 characters, a fixed 39-character shape.
 */
export const gcpApiKey = defineRule({
  id: 'gcp.api_key',
  label: 'Google API Key',
  description: 'Google Cloud and Maps API keys beginning AIza',
  token: 'GOOGLE_API_KEY',
  pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
});

export const cloudRules: readonly Rule[] = [
  awsAccessKeyId,
  awsSecretAccessKey,
  gcpApiKey,
];
