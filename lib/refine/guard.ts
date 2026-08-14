import { detect, placeholderPattern, redact } from '../detector/engine';
import type { Finding, Rule } from '../detector/types';

/**
 * Safety guards around refinement.
 *
 * **Refinement runs on redacted text, never the original.** Even with an
 * on-device model this ordering is load-bearing:
 *
 *  - The redaction step is where the user decides what their secret becomes. A
 *    refinement pass over the raw draft could reproduce or paraphrase a secret
 *    into text that is then approved without a second look.
 *  - If a future build ever gains a remote model — a BYOK option, a cloud
 *    fallback — this ordering is the only thing standing between a secret and
 *    an API. Getting it right now costs nothing; retrofitting it later means
 *    auditing every call site.
 */

export interface PreparedInput {
  /** Text safe to send to the model: secrets already replaced. */
  text: string;
  /** placeholder -> real value, for restoring afterwards. */
  map: Readonly<Record<string, string>>;
  /** Findings that were redacted out. */
  findings: readonly Finding[];
}

/**
 * Redacts a draft before it reaches the model.
 *
 * Runs the full detector rather than trusting anything the caller has already
 * computed: the user may have edited the draft since it was last scanned, and
 * a stale finding set would leave a new secret exposed.
 *
 * `disabledRuleIds` is honoured, so refinement uses the SAME rule set as
 * sending. Being more conservative here would be incoherent — a user willing
 * to send an internal hostname to ChatGPT is certainly willing to have it
 * processed by a model on their own machine — and it would create a confusing
 * asymmetry: "why was my IP hidden from the improver but not from the chat?"
 */
export function prepareForModel(
  draft: string,
  options: { disabledRuleIds?: readonly string[]; rules?: readonly Rule[] } = {},
): PreparedInput {
  const findings = detect(
    draft,
    { disabledRuleIds: options.disabledRuleIds },
    options.rules,
  );

  const { text, map } = redact(draft, findings);
  return { text, map, findings };
}

/** Every placeholder appearing in a string. */
function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(placeholderPattern())].map((m) => m[0]))];
}

export type ResponseRejection =
  /** The model altered, dropped, or invented a placeholder. */
  | 'placeholders-changed'
  /** The response contains a secret the input did not. */
  | 'introduced-secret'
  /** Nothing usable came back. */
  | 'empty';

export type ResponseCheck =
  | { ok: true; text: string }
  | { ok: false; reason: ResponseRejection };

/**
 * Validates a model response before it is shown to the user.
 *
 * Two checks, both about trust rather than quality:
 *
 * **Placeholders must survive exactly.** A model that "tidies"
 * `[REDACTED_AWS_KEY_1]` breaks re-hydration, and worse, leaves the user
 * believing a different value was sent than actually was. Rejecting is the
 * right response: a refinement is a convenience, and no convenience is worth
 * misrepresenting what left the machine.
 *
 * **The output is re-scanned.** The model may reformat something the detector
 * did not match in the original into something it would now — splitting a key
 * across lines, say, or unwrapping a quoted value. Scanning the output closes
 * that gap.
 */
export function checkResponse(
  response: string,
  input: PreparedInput,
  options: { disabledRuleIds?: readonly string[]; rules?: readonly Rule[] } = {},
): ResponseCheck {
  const text = response.trim();
  if (text === '') return { ok: false, reason: 'empty' };

  const expected = placeholdersIn(input.text).sort();
  const actual = placeholdersIn(text).sort();

  if (expected.length !== actual.length) {
    return { ok: false, reason: 'placeholders-changed' };
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i] !== actual[i]) {
      return { ok: false, reason: 'placeholders-changed' };
    }
  }

  const findings = detect(
    text,
    { disabledRuleIds: options.disabledRuleIds },
    options.rules,
  );
  if (findings.some((f) => f.tier === 'high')) {
    return { ok: false, reason: 'introduced-secret' };
  }

  return { ok: true, text };
}

/**
 * Puts the user's real values back into the refined text.
 *
 * The suggestion is shown against their original draft, so it must read in
 * their own terms — a diff full of `[REDACTED_AWS_KEY_1]` would be unreadable
 * and would obscure what actually changed.
 *
 * This is a local string substitution. The restored values were never sent to
 * the model and never leave the machine.
 */
export function restore(text: string, map: Readonly<Record<string, string>>): string {
  let out = text;
  for (const [placeholder, value] of Object.entries(map)) {
    out = out.split(placeholder).join(value);
  }
  return out;
}
