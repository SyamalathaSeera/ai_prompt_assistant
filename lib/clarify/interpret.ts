import { run } from '../model';
import { hasPreamble, intentRetention } from '../refine/evaluate';
import { checkResponse, prepareForModel, restore } from '../refine/guard';
import { cleanResponse } from '../refine/prompt';
import type { Rule } from '../detector/types';
import type { AssembledContext, ContextTurn } from './context';
import { groundResolutions } from './grounding';
import type { Resolution } from './grounding';
import { buildClarificationPrompt } from './prompt';
import type { VagueReference } from './references';

/**
 * Producing one interpretation.
 *
 * Orchestrates: redact → ask the model → validate → restore → ground. The
 * first four steps are refinement's pipeline and reuse its code deliberately;
 * the fifth is this feature's own bar and is the reason it is safe to show
 * someone a sentence and ask "is this what you meant".
 *
 * Everything returns a value. A clarification that cannot be produced is a
 * silent no-op, never an error the user has to dismiss — this feature is an
 * offer, and an offer that fails should cost nothing.
 */

export type InterpretFailure =
  /** No usable model, or it could not respond. */
  | 'unavailable'
  | 'not-downloaded'
  | 'timeout'
  | 'aborted'
  | 'too-long'
  | 'failed'
  /** Placeholders were altered, or a secret appeared that was not in the input. */
  | 'unsafe'
  /** The rewrite introduced something the conversation does not contain. */
  | 'ungrounded'
  /** It rewrote the prompt instead of resolving its references. */
  | 'rewrote-too-much'
  /** Some references were resolved and others were left behind. */
  | 'partial'
  /** Nothing was actually resolved. */
  | 'no-change';

export type InterpretResult =
  | { ok: true; text: string; resolutions: readonly Resolution[] }
  | { ok: false; reason: InterpretFailure; message: string };

/**
 * How long an interpretation may take.
 *
 * Matches refinement's measured budget. That figure came from 27 real runs and
 * the reasoning behind it — that a timeout exists to stop a hung call, not to
 * enforce an opinion about patience — applies here unchanged. If anything this
 * prompt is longer, since it carries conversation context, so borrowing the
 * number is the conservative direction.
 *
 * Not itself measured. When this feature meets the real model it needs its own
 * numbers, exactly as refinement did in 0.3.0.5.
 */
export const CLARIFY_TIMEOUT_MS = 20_000;

/**
 * How much of the draft must survive.
 *
 * Far stricter than refinement's 0.25, and for the opposite reason.
 * Refinement is licensed to throw wording away; clarification is instructed to
 * change nothing but the references. A rewrite that kept less than most of the
 * draft did not resolve a reference — it answered the prompt, or rewrote it,
 * and either way it is not what the user is being asked to confirm.
 */
const MIN_RETENTION = 0.7;

const MESSAGES: Record<InterpretFailure, string> = {
  unavailable: 'Clarification is not available in this browser.',
  'not-downloaded': 'The on-device model needs to be downloaded first.',
  timeout: 'That took too long. Your prompt is unchanged.',
  aborted: 'Cancelled.',
  'too-long': 'This conversation is too long to read on this device.',
  failed: 'Could not work out what you meant. Your prompt is unchanged.',
  unsafe: 'The suggestion was discarded because it changed your redacted values.',
  ungrounded: 'The suggestion added something the conversation does not contain.',
  'rewrote-too-much': 'That rewrote your prompt instead of resolving it.',
  partial: 'Only part of that could be worked out with any confidence.',
  'no-change': 'Nothing here needed clarifying.',
};

/** Escapes a literal for use inside a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Flagged references the rewrite left behind.
 *
 * The confidence test, and it is deliberately all-or-nothing. A half-resolved
 * prompt — "add the login form over there" — is a *worse* thing to put in front
 * of someone than the draft they wrote. They were comfortable with the
 * ambiguity; now they are being asked to evaluate a sentence that resolved one
 * half and not the other, which is a question they did not have before and
 * cannot answer any better than we can.
 *
 * The model is told to leave a reference alone when the conversation does not
 * make it clear, so this firing usually means it did exactly as instructed and
 * there simply was not enough to go on. Staying quiet is the correct response
 * to that, not showing the part we managed.
 */
function unresolvedReferences(
  rewrite: string,
  references: readonly VagueReference[],
): VagueReference[] {
  return references.filter((reference) => {
    const phrase = reference.text.trim();
    if (phrase === '') return false;
    return new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'i').test(rewrite);
  });
}

export interface InterpretOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  disabledRuleIds?: readonly string[];
  rules?: readonly Rule[];
}

/** Whether two texts differ by more than whitespace. */
function isMeaningfullyDifferent(before: string, after: string): boolean {
  const normalise = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalise(before) !== normalise(after);
}

/**
 * The draft with its vague references cut out.
 *
 * The baseline for measuring how much of the draft survived. Measuring against
 * the draft as written would count the references themselves as lost meaning —
 * but a reference disappearing is the feature working, not failing. "Add this
 * over there" resolving to "add the login form to the settings page" keeps
 * every word that carried intent and drops exactly the two phrases that did
 * not, and the naive measurement scores that at 50%.
 *
 * Assumes `references` were found in this same string, which is what
 * `needsClarification` returns and what the store passes through.
 */
function withoutReferences(draft: string, references: readonly VagueReference[]): string {
  let out = draft;

  // Back to front, so each removal leaves earlier offsets valid.
  for (const ref of [...references].sort((a, b) => b.start - a.start)) {
    if (ref.start < 0 || ref.end > out.length) continue;
    out = `${out.slice(0, ref.start)} ${out.slice(ref.end)}`;
  }

  return out;
}

/**
 * Produces one concrete reading of a draft.
 *
 * `context` must already be redacted — it arrives that way from
 * `assembleContext`. `turns` is the full, unredacted turn array the context was
 * built from, used only to attribute resolutions to the message they came
 * from; it is never sent anywhere.
 */
export async function interpret(
  draft: string,
  context: AssembledContext,
  references: readonly VagueReference[],
  turns: readonly ContextTurn[],
  options: InterpretOptions = {},
): Promise<InterpretResult> {
  const trimmed = draft.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'no-change', message: MESSAGES['no-change'] };
  }

  // Step 1: redact the draft. The context was redacted when it was assembled.
  const prepared = prepareForModel(trimmed, {
    disabledRuleIds: options.disabledRuleIds,
    rules: options.rules,
  });

  // Step 2: ask, using only redacted text on both sides.
  const result = await run(
    buildClarificationPrompt(prepared.text, context.text, references),
    { signal: options.signal, timeoutMs: options.timeoutMs ?? CLARIFY_TIMEOUT_MS },
  );

  if (!result.ok) {
    return { ok: false, reason: result.reason, message: MESSAGES[result.reason] };
  }

  // Step 3: validate before the user sees anything.
  const cleaned = cleanResponse(result.text);
  const checked = checkResponse(cleaned, prepared, {
    disabledRuleIds: options.disabledRuleIds,
    rules: options.rules,
  });

  if (!checked.ok) {
    return {
      ok: false,
      reason: checked.reason === 'empty' ? 'failed' : 'unsafe',
      message: checked.reason === 'empty' ? MESSAGES.failed : MESSAGES.unsafe,
    };
  }

  // Step 4: put the user's real values back, locally.
  const restored = restore(checked.text, prepared.map);

  if (!isMeaningfullyDifferent(trimmed, restored)) {
    return { ok: false, reason: 'no-change', message: MESSAGES['no-change'] };
  }

  // Step 5: it was asked to resolve references, not to rewrite.
  const baseline = withoutReferences(draft, references).trim();
  if (hasPreamble(restored) || intentRetention(baseline, restored) < MIN_RETENTION) {
    return { ok: false, reason: 'rewrote-too-much', message: MESSAGES['rewrote-too-much'] };
  }

  /*
   * Step 6: every added phrase must trace to a turn the model was shown.
   *
   * The step that makes the question askable. Without it the user would be
   * shown a confident sentence and asked whether it matches what they meant,
   * with no way to check — which is a worse position than the ambiguity they
   * started with.
   */
  const grounded = groundResolutions(trimmed, restored, turns, context.turns);
  if (!grounded.ok) {
    return { ok: false, reason: 'ungrounded', message: MESSAGES.ungrounded };
  }

  // Something changed, but nothing that traces back to the conversation —
  // there is no resolution to show, so there is nothing worth asking about.
  if (grounded.resolutions.length === 0) {
    return { ok: false, reason: 'no-change', message: MESSAGES['no-change'] };
  }

  // Step 7: all of it, or none of it.
  if (unresolvedReferences(restored, references).length > 0) {
    return { ok: false, reason: 'partial', message: MESSAGES.partial };
  }

  return { ok: true, text: restored, resolutions: grounded.resolutions };
}
