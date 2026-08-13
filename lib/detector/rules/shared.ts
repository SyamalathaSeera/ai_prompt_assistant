import { isLikelyPlaceholder } from '../validators';
import type { Rule, Tier } from '../types';

/**
 * Builds a rule with the boilerplate filled in.
 *
 * Every rule gets the documentation-placeholder gate for free. A real
 * credential never looks like `your-api-key-here` or `[REDACTED_…]`, so
 * applying it universally costs nothing and removes a whole class of false
 * positive — including making redaction idempotent, since our own placeholder
 * tokens can never be re-detected.
 *
 * `skipPlaceholderCheck` exists for rules matching large multi-line blocks,
 * where the heuristics are aimed at short values and have no useful meaning.
 */
export function defineRule(spec: {
  id: string;
  label: string;
  description?: string;
  pattern: RegExp;
  token: string;
  tier?: Tier;
  captureGroup?: number;
  specificity?: number;
  skipPlaceholderCheck?: boolean;
  validate?: Rule['validate'];
}): Rule {
  const { validate, skipPlaceholderCheck } = spec;

  return {
    id: spec.id,
    label: spec.label,
    description: spec.description,
    tier: spec.tier ?? 'high',
    pattern: spec.pattern,
    captureGroup: spec.captureGroup,
    specificity: spec.specificity,
    validate: (value, ctx) => {
      if (!skipPlaceholderCheck && isLikelyPlaceholder(value)) return false;
      return validate ? validate(value, ctx) : true;
    },
    token: spec.token,
  };
}
