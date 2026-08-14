import { describe, expect, it } from 'vitest';
import { checkResponse, prepareForModel, restore } from './guard';
import { ALL_RULES } from '../detector/rules';
import { DEFAULT_SETTINGS } from '../policy/defaults';

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';
const DRAFT = `Fix this auth error. My key is ${AWS_KEY} and the db is ` +
  'postgres://app:hunter2pass@db.internal:5432/orders';

/**
 * The ordering guarantee.
 *
 * Refinement runs on redacted text, never the original. These tests exist so
 * that a future refactor cannot quietly reverse the order — including a future
 * build that adds a remote model, where this is the only thing between a
 * secret and an API.
 */

describe('preparing input for the model', () => {
  it('removes every secret before the model sees anything', () => {
    const prepared = prepareForModel(DRAFT, { rules: ALL_RULES });

    expect(prepared.text).not.toContain(AWS_KEY);
    expect(prepared.text).not.toContain('hunter2pass');
    expect(prepared.text).toContain('[REDACTED_');
  });

  it('keeps the surrounding request intact', () => {
    // The model still has to understand the task, or the refinement is
    // useless. Redaction preserves context by design.
    const prepared = prepareForModel(DRAFT, {
      rules: ALL_RULES,
      disabledRuleIds: DEFAULT_SETTINGS.disabledRuleIds,
    });

    expect(prepared.text).toContain('Fix this auth error');
    expect(prepared.text).toContain('postgres://app:');
    expect(prepared.text).toContain('@db.internal:5432/orders');
  });

  it('respects the rules the user has turned off', () => {
    /*
     * A deliberate decision, not an accident of plumbing.
     *
     * Refinement uses the SAME rule set as sending. Being more conservative
     * here would be incoherent: a user willing to send an internal hostname to
     * ChatGPT is certainly willing to have it processed by a model on their
     * own machine. Being less conservative would be indefensible.
     *
     * Matching also avoids a confusing asymmetry — "why was my IP hidden from
     * the improver but not from the chat?"
     */
    const withHostRule = prepareForModel(DRAFT, { rules: ALL_RULES });
    const asUserConfigured = prepareForModel(DRAFT, {
      rules: ALL_RULES,
      disabledRuleIds: DEFAULT_SETTINGS.disabledRuleIds,
    });

    expect(withHostRule.text).toContain('[REDACTED_INTERNAL_HOST_1]');
    expect(asUserConfigured.text).toContain('db.internal');
  });

  it('re-scans rather than trusting a caller’s findings', () => {
    // The user may have edited the draft since it was last scanned, and a
    // stale finding set would leave a new secret exposed.
    const edited = `${DRAFT} and also sk_live_9mQ4vX2nR7tK1pL5wZ8yB3cF`;
    const prepared = prepareForModel(edited, { rules: ALL_RULES });

    expect(prepared.text).not.toContain('sk_live_9mQ4vX2nR7tK1pL5wZ8yB3cF');
  });

  it('returns the map needed to restore afterwards', () => {
    const prepared = prepareForModel(DRAFT, { rules: ALL_RULES });
    expect(Object.values(prepared.map)).toContain(AWS_KEY);
  });

  it('passes clean text through unchanged', () => {
    const clean = 'How do promises work in JavaScript?';
    expect(prepareForModel(clean, { rules: ALL_RULES }).text).toBe(clean);
  });
});

describe('validating the model response', () => {
  const prepared = prepareForModel(DRAFT, { rules: ALL_RULES });
  const placeholder = Object.keys(prepared.map)[0]!;

  it('accepts a response that preserves every placeholder', () => {
    const response = prepared.text.replace('Fix this auth error', 'Please fix this error');
    const result = checkResponse(response, prepared, { rules: ALL_RULES });

    expect(result.ok).toBe(true);
  });

  it('rejects a response that altered a placeholder', () => {
    // A model that "tidies" [REDACTED_AWS_KEY_1] breaks re-hydration and makes
    // the user believe a different value was sent than actually was.
    const response = prepared.text.replace(placeholder, '[REDACTED_KEY]');
    const result = checkResponse(response, prepared, { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('placeholders-changed');
  });

  it('rejects a response that dropped a placeholder', () => {
    const response = prepared.text.replace(placeholder, '');
    const result = checkResponse(response, prepared, { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('placeholders-changed');
  });

  it('rejects a response that invented a placeholder', () => {
    const response = `${prepared.text} and [REDACTED_INVENTED_9]`;
    const result = checkResponse(response, prepared, { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('placeholders-changed');
  });

  it('rejects a response containing a secret the input did not', () => {
    // The model may reformat something the detector missed in the original
    // into something it would now match.
    const response = `${prepared.text} example key AKIAIOSFODNN7EXAMPLE`;
    const result = checkResponse(response, prepared, { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('introduced-secret');
  });

  it('rejects an empty response', () => {
    const result = checkResponse('   ', prepared, { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });
});

describe('restoring the user’s values', () => {
  it('puts real values back for display', () => {
    // The suggestion is shown against the original draft, so it must read in
    // the user's own terms. A diff full of placeholders would obscure what
    // actually changed.
    const prepared = prepareForModel(DRAFT, { rules: ALL_RULES });
    const restored = restore(prepared.text, prepared.map);

    expect(restored).toContain(AWS_KEY);
    expect(restored).toContain('hunter2pass');
    expect(restored).not.toContain('[REDACTED_');
  });

  it('round-trips exactly', () => {
    const prepared = prepareForModel(DRAFT, { rules: ALL_RULES });
    expect(restore(prepared.text, prepared.map)).toBe(DRAFT);
  });

  it('replaces every occurrence of a repeated placeholder', () => {
    const repeated = `key ${AWS_KEY} and again ${AWS_KEY}`;
    const prepared = prepareForModel(repeated, { rules: ALL_RULES });

    expect(restore(prepared.text, prepared.map)).toBe(repeated);
  });

  it('is a no-op with an empty map', () => {
    expect(restore('unchanged text', {})).toBe('unchanged text');
  });
});
