import { run } from '../model';
import type { Rule } from '../detector/types';
import { evaluateRefinement } from './evaluate';
import type { QualityProblem, QualityReport } from './evaluate';
import { checkResponse, prepareForModel, restore } from './guard';
import { buildRefinementPrompt, cleanResponse, DEFAULT_STYLE } from './prompt';
import type { RefinementStyle } from './prompt';

export { DEFAULT_STYLE, RETIRED_STYLES, STYLES, getStyle } from './prompt';
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
  | {
      ok: false;
      reason: RefineFailure;
      message: string;
      /**
       * Which checks the rewrite failed, when the reason is `low-quality`.
       *
       * Carried rather than dropped so a caller can report more than "it did
       * not work". The evaluator computes this either way; discarding it left
       * the one useful fact about the failure on the floor.
       */
      problems?: readonly QualityProblem[];
    };

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
 * What each check refuses, said in a way that tells the user something.
 *
 * The original message covered all six with one sentence, and "drifted from
 * what you wrote" is true of every one of them without being informative about
 * any. Someone who sees it twice has no idea whether to reword their draft,
 * try a different style, or stop bothering — and the one person who could tell
 * us which check is too strict in practice is the person watching it fire.
 *
 * Ordered by how much the answer changes what they would do next, because a
 * rewrite usually breaks more than one rule at a time and only the first line
 * gets read.
 */
const QUALITY_ORDER: readonly QualityProblem[] = [
  'fabricated-specifics',
  'too-long',
  'intent-lost',
  'constraints-dropped',
  'preamble',
  'too-short',
];

const QUALITY_MESSAGES: Record<QualityProblem, string> = {
  'fabricated-specifics':
    'The rewrite added details you never wrote, so it was discarded.',
  'too-long':
    'The model answered the prompt instead of rewriting it, so it was discarded.',
  'intent-lost':
    'The rewrite lost most of what you were asking about, so it was discarded.',
  'constraints-dropped':
    'The rewrite dropped the limits you set, so it was discarded.',
  preamble:
    'The rewrite came back wrapped in commentary, so it was discarded.',
  'too-short': 'The rewrite came back too short to be a request, so it was discarded.',
};

/**
 * Names the invented terms when that is what went wrong.
 *
 * Safe to show: these are words present in the suggestion and absent from the
 * draft, and the model only ever saw redacted text — so a fabrication cannot
 * be one of the user's own values. It is also the single most useful thing to
 * put on screen, because "it made up EC2 and us-east-1" is checkable and
 * "the rewrite drifted" is not.
 */
function describeQualityFailure(report: QualityReport): string {
  const worst = QUALITY_ORDER.find((problem) => report.problems.includes(problem));
  if (!worst) return MESSAGES['low-quality'];

  const base = QUALITY_MESSAGES[worst];
  if (worst !== 'fabricated-specifics' || report.invented.length === 0) return base;

  const named = report.invented.slice(0, 3).join(', ');
  return `The rewrite added details you never wrote (${named}), so it was discarded.`;
}

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
  const hasPlaceholders = Object.keys(prepared.map).length > 0;

  const result = await run(buildRefinementPrompt(prepared.text, style, { hasPlaceholders }), {
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
    return {
      ok: false,
      reason: 'low-quality',
      message: describeQualityFailure(quality),
      problems: quality.problems,
    };
  }

  // Offering an identical rewrite wastes the user's attention and makes the
  // feature feel useless. Saying "this already reads clearly" is more useful
  // than presenting a diff with nothing in it.
  if (!isMeaningfullyDifferent(trimmed, restored)) {
    return { ok: false, reason: 'no-change', message: MESSAGES['no-change'] };
  }

  return { ok: true, text: restored, style };
}
