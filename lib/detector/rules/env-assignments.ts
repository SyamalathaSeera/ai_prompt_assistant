import { defineRule } from './shared';
import { hasEnoughDistinctCharacters } from '../validators';
import type { Rule } from '../types';

/**
 * Secret-shaped assignments: `.env` files, config blocks, shell exports.
 *
 * This is the loosest rule in the high tier and therefore the one most likely
 * to misfire, so it is constrained on three axes at once:
 *
 *  1. the key name must contain a secret-ish word (SECRET, TOKEN, PASSWORD, …)
 *  2. the value must not look like code — no brackets, `$`, backticks, or
 *     template markers, which rules out `TOKEN=$MY_TOKEN`, `KEY={{ var }}`,
 *     and `TOKEN=getToken()`
 *  3. the value must have enough distinct characters to be a real secret,
 *     which rules out `PASSWORD=xxxxxxxxxx`
 *
 * Only the value is captured, so `STRIPE_SECRET_KEY=[REDACTED_ENV_SECRET_1]`
 * keeps the shape of the config intact for the model.
 *
 * Task 3's `isLikelyPlaceholder` will tighten this further by rejecting
 * documentation values like `your-secret-here`.
 */
export const envSecretAssignment = defineRule({
  id: 'env.secret_assignment',
  label: 'Secret in Configuration',
  description: 'Values assigned to names containing SECRET, TOKEN, PASSWORD or similar',
  token: 'ENV_SECRET',
  pattern:
    /(?:^|[\r\n])[ \t]*(?:export[ \t]+)?[A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL|AUTH)[A-Za-z0-9_.-]*[ \t]*[:=][ \t]*["']?([^\s"'`#(){}$<>[\],]{8,})["']?/gi,
  captureGroup: 1,
  // Deliberately below the default. This rule is a fallback for secrets we
  // have no specific pattern for; when a recognised vendor key appears in a
  // config assignment — the most common real case — the vendor rule should
  // win the overlap so the user is told exactly which credential leaked.
  specificity: -1,
  validate: (value) => hasEnoughDistinctCharacters(value),
});

export const envAssignmentRules: readonly Rule[] = [envSecretAssignment];
