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

/**
 * The same secret words, written in a sentence rather than in a config file.
 *
 * `envSecretAssignment` above is anchored to the start of a line, which is what
 * keeps it precise enough to block a message. That anchor also means it never
 * sees the way people actually type in a chat window:
 *
 *   deploy with AKIA… and password: hunter2pass     ← missed by the rule above
 *   my password: hunter2pass                        ← missed
 *   AWS Password- hunter2pass                       ← missed (hyphen, not `:`)
 *
 * Found by using the extension rather than by reading it: a real draft on
 * chatgpt.com had a key and a password, and only the key was caught. The
 * labelled corpus could not have surfaced this, because its config samples all
 * put assignments at the start of a line — which is exactly what the rule
 * expects and exactly what a person typing prose does not do.
 *
 * **LOW tier, deliberately.** Dropping the anchor buys recall and costs
 * certainty: "your password: must be at least twelve characters" contains no
 * secret, and nothing in this pattern can tell it from one that does. Under the
 * rule stated in `index.ts` — a rule belongs in the high tier only if firing on
 * innocent text would be a *bug* — that disqualifies it from blocking. So it
 * warns, the message still goes, and the user decides. Being wrong while
 * blocking is the fastest way to get uninstalled.
 *
 * `-` joins `:` and `=` as a separator for the same reason the anchor came off:
 * "Password- value" is a real thing people write, and only a config file would
 * insist on an equals sign. **It must be followed by whitespace**, which is not
 * a detail — without that, `<your-secret-access-key>` reads as the key `secret`
 * assigned the value `access-key`, and a documentation placeholder becomes a
 * finding. Hyphens live inside identifiers far more often than they separate
 * one from a value; the space is what tells the two apart.
 */
export const inlineSecretMention = defineRule({
  id: 'env.inline_secret',
  label: 'Password or key in a sentence',
  description:
    'Secret-looking values written mid-sentence, such as "my password: …". Suggested only, never blocking',
  tier: 'low',
  token: 'INLINE_SECRET',
  pattern:
    /\b[A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)[A-Za-z0-9_.-]*[ \t]*(?:[:=][ \t]*|-[ \t]+)["']?([^\s"'`#(){}$<>[\],]{8,})["']?/gi,
  captureGroup: 1,
  /*
   * Below `envSecretAssignment`, which is itself below the vendor rules.
   *
   * The ordering matters on a line like `AWS_SECRET_ACCESS_KEY=…`, where all
   * three could match: the vendor rule should win so the user is told which
   * credential leaked, then the config rule, and this one only when neither
   * applies. Without it, a blocking finding could be demoted to an advisory one
   * by a rule that is deliberately less sure of itself.
   */
  specificity: -2,
  validate: (value) => hasEnoughDistinctCharacters(value),
});

export const envAssignmentRules: readonly Rule[] = [
  envSecretAssignment,
  inlineSecretMention,
];
