import { defineRule } from './shared';
import type { Rule } from '../types';

/**
 * Vendor API tokens.
 *
 * Every rule here anchors on a vendor-assigned prefix. That prefix is what
 * earns these a place in the high tier — the shapes do not occur in ordinary
 * prose or code.
 */

/**
 * Anthropic — `sk-ant-`. Declared before the OpenAI rule and excluded from it
 * by lookahead, so the two can never both claim the same span.
 */
export const anthropicApiKey = defineRule({
  id: 'anthropic.api_key',
  label: 'Anthropic API Key',
  description: 'Anthropic API keys beginning sk-ant-',
  token: 'ANTHROPIC_KEY',
  pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
});

/**
 * OpenAI — `sk-`, including the `sk-proj-` and `sk-svcacct-` variants.
 * The negative lookahead keeps Anthropic keys out rather than relying on
 * overlap resolution to sort it out afterwards.
 */
export const openaiApiKey = defineRule({
  id: 'openai.api_key',
  label: 'OpenAI API Key',
  description: 'OpenAI API keys beginning sk-, including project keys',
  token: 'OPENAI_KEY',
  pattern: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g,
});

/** GitHub personal access tokens, classic format: prefix plus exactly 36 chars. */
export const githubToken = defineRule({
  id: 'github.token',
  label: 'GitHub Token',
  description: 'GitHub personal access tokens beginning ghp_, gho_ or similar',
  token: 'GITHUB_TOKEN',
  pattern: /\bgh[pousr]_[A-Za-z0-9]{36}\b/g,
});

/** GitHub fine-grained personal access token. */
export const githubFineGrainedToken = defineRule({
  id: 'github.pat_fine_grained',
  label: 'GitHub Fine-Grained Token',
  description: 'GitHub fine-grained tokens beginning github_pat_',
  token: 'GITHUB_TOKEN',
  pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g,
});

/** Slack tokens — bot, user, app, refresh, and legacy workspace forms. */
export const slackToken = defineRule({
  id: 'slack.token',
  label: 'Slack Token',
  description: 'Slack bot, user and app tokens beginning xox',
  token: 'SLACK_TOKEN',
  pattern: /\bxox[baprse]-[A-Za-z0-9-]{10,}/g,
});

/**
 * Stripe live secret and restricted keys.
 *
 * Test keys (`sk_test_`) are deliberately excluded from the high tier: they
 * cannot move money, so blocking submission over one would be exactly the kind
 * of false alarm that gets this class of extension uninstalled.
 */
export const stripeLiveKey = defineRule({
  id: 'stripe.live_key',
  label: 'Stripe Live Key',
  description: 'Stripe live keys that can move real money. Test keys are ignored',
  token: 'STRIPE_KEY',
  pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g,
});

/** SendGrid API key — fixed three-segment shape. */
export const sendgridApiKey = defineRule({
  id: 'sendgrid.api_key',
  label: 'SendGrid API Key',
  description: 'SendGrid API keys beginning SG.',
  token: 'SENDGRID_KEY',
  pattern: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
});

export const vendorRules: readonly Rule[] = [
  anthropicApiKey,
  openaiApiKey,
  githubToken,
  githubFineGrainedToken,
  slackToken,
  stripeLiveKey,
  sendgridApiKey,
];
