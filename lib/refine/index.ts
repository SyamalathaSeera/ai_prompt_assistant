import { run } from '../model';
import type { Rule } from '../detector/types';
import { evaluateRefinement } from './evaluate';
import { checkResponse, prepareForModel, restore } from './guard';
import { buildRefinementPrompt, cleanResponse, DEFAULT_STYLE } from './prompt';
import type { RefinementStyle } from './prompt';

export { DEFAULT_STYLE, STYLES, getStyle } from './prompt';
export type { RefinementStyle, StyleDefinition } from './prompt';
export {
  evaluateRefinement,
  hasPreamble,
  inventedSpecifics,
  intentRetention,
} from './evaluate';
export type { QualityProblem, QualityReport } from './evaluate';

/**
 * How long a refinement may take before it is abandoned.
 *
 * Set from measurement, not from taste. The first value was 8s, chosen on the
 * reasoning that nobody waits longer than that — and a run of 21 refinements
 * against the real on-device model showed a median of 5.7s, a 90th percentile
 * of 10.1s, and a slowest of 10.6s. That budget would have killed roughly a
 * quarter of successful rewrites and reported them as failures.
 *
 * 20s is deliberately generous: a timeout exists to stop a hung call, not to
 * enforce an opinion about patience. Waiting is the user's to end — the button
 * cancels while it works, which is the control that actually answers "this is
 * taking too long", and their draft is untouched either way.
 *
 * See test/refine-corpus/on-device-2026-08-13.json for the measurements.
 */
export const REFINE_TIMEOUT_MS = 20_000;

/**
 * Prompt refinement.
 *
 * Orchestrates: redact → ask the model → validate → restore. The redaction
 * step is not optional and not reorderable; see `guard.ts` for why.
 */

export type RefineFailure =
  /** No usable model, or it could not respond. */
  | 'unavailable'
  | 'not-downloaded'
  | 'timeout'
  | 'aborted'
  | 'too-long'
  | 'failed'
  /** The response was rejected by our own checks. */
  | 'unsafe'
  /** The rewrite broke one of the rules it was given. */
  | 'low-quality'
  /** The model returned the draft essentially unchanged. */
  | 'no-change';

export type RefineResult =
  | { ok: true; text: string; style: RefinementStyle }
  | { ok: false; reason: RefineFailure; message: string };

export interface RefineOptions {
  style?: RefinementStyle;
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

const MESSAGES: Record<RefineFailure, string> = {
  unavailable: 'Prompt improvement is not available in this browser.',
  'not-downloaded': 'The on-device model needs to be downloaded first.',
  timeout: 'That took too long. Your prompt is unchanged.',
  aborted: 'Cancelled.',
  'too-long': 'This prompt is too long to improve on this device.',
  failed: 'The model could not rewrite this. Your prompt is unchanged.',
  unsafe: 'The suggestion was discarded because it changed your redacted values.',
  'low-quality': 'The rewrite drifted from what you wrote, so it was discarded.',
  'no-change': 'This prompt already reads clearly.',
};

/**
 * Refines a draft prompt.
 *
 * Returns a result rather than throwing. Every failure leaves the user's draft
 * exactly as it was — refinement is a convenience, and the cost of it not
 * working must be zero.
 */
export async function refine(
  draft: string,
  options: RefineOptions = {},
): Promise<RefineResult> {
  const style = options.style ?? DEFAULT_STYLE;

  const trimmed = draft.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'failed', message: 'There is nothing to improve yet.' };
  }

  // Step 1: redact. Never send the raw draft.
  const prepared = prepareForModel(trimmed, {
    disabledRuleIds: options.disabledRuleIds,
    rules: options.rules,
  });

  // Step 2: ask the model, using only the redacted text.
  const result = await run(buildRefinementPrompt(prepared.text, style), {
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? REFINE_TIMEOUT_MS,
  });

  if (!result.ok) {
    return { ok: false, reason: result.reason, message: MESSAGES[result.reason] };
  }

  // Step 3: validate before the user ever sees it.
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

  /*
   * Step 5: refuse a rewrite that broke the rules it was given.
   *
   * The bar for this feature is that a refusal is better than a mediocre
   * suggestion. Prompt-enhancer extensions are a crowded category with weak
   * retention, and the reason is that a suggestion which quietly loses the
   * user's meaning — or invents a filename they never mentioned — costs more
   * than it saves. Checked against the restored text so the user's real values
   * count as their own words rather than as fabrications.
   */
  const quality = evaluateRefinement(trimmed, restored, style);
  if (!quality.ok) {
    return { ok: false, reason: 'low-quality', message: MESSAGES['low-quality'] };
  }

  // Offering an identical rewrite wastes the user's attention and makes the
  // feature feel useless. Saying "this already reads clearly" is more useful
  // than presenting a diff with nothing in it.
  if (!isMeaningfullyDifferent(trimmed, restored)) {
    return { ok: false, reason: 'no-change', message: MESSAGES['no-change'] };
  }

  return { ok: true, text: restored, style };
}
