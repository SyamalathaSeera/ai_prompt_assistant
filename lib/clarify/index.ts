import { anchorVariety, findVagueReferences } from './references';
import type { VagueReference } from './references';

export { findVagueReferences, maskCode, anchorVariety } from './references';
export type { ReferenceKind, VagueReference } from './references';
export {
  assembleContext,
  estimateTokens,
  isContextFor,
  CONTEXT_TOKEN_BUDGET,
  MAX_CONTEXT_TURNS,
} from './context';
export type {
  AssembledContext,
  AssembleOptions,
  ContextResult,
  ContextSkipReason,
  ContextTurn,
  IncludedTurn,
} from './context';
export { addedPhrases, groundResolutions, stem } from './grounding';
export type { GroundingResult, Resolution } from './grounding';

/*
 * `interpret` is deliberately NOT re-exported here.
 *
 * It is the only module in this directory that reaches `lib/model`, and this
 * barrel is imported by tests running in the DOM-free node project. Re-exporting
 * it would pull the model layer — and the browser globals it probes — into the
 * environment whose whole job is to prove this code does not need them.
 *
 * Consumers that want it import `@/lib/clarify/interpret` directly, which makes
 * the dependency visible at the call site rather than hidden in a barrel.
 */

/**
 * The clarification gate.
 *
 * Answers one question — does this draft need clarifying at all? — using
 * nothing but the draft and a count of prior turns. No model, no network, no
 * DOM. Milestone 0.4.0.0 Task 2 only assembles context, and Task 3 only calls
 * a model, when this says yes.
 *
 * That ordering is the point. Clarification is the noisiest feature in the
 * product and the only one that offers an opinion about what the user *meant*.
 * Putting a cheap, deterministic, testable gate in front of it means the cost
 * of being wrong is a silent no-op rather than a wasted model call and an
 * interruption.
 */

/** Why a draft was not offered clarification. */
export type ClarifySkipReason =
  /** Nothing typed yet. */
  | 'empty'
  /** A fresh chat: there is no earlier turn for a reference to point at. */
  | 'no-history'
  /** Nothing in the draft gestures at anything. */
  | 'no-reference'
  /** Long and specific enough that it answers its own question. */
  | 'self-contained';

export type ClarifyCheck =
  | { needed: true; references: readonly VagueReference[] }
  | { needed: false; reason: ClarifySkipReason };

export interface ClarifyCheckOptions {
  /**
   * How many turns already exist in this conversation.
   *
   * A count rather than the messages themselves, so this module stays pure and
   * the caller keeps ownership of the adapter. Task 2 supplies the real thing.
   */
  priorTurns: number;
}

/**
 * Word count above which a draft is treated as a considered instruction rather
 * than a quick aside.
 *
 * Provisional. It is a guess about writing habits, and the honest place to
 * settle it is beta — like the detector's corpus metrics, a number chosen at a
 * desk should not be mistaken for a measured one.
 */
export const LONG_PROMPT_WORDS = 40;

/**
 * How many distinct kinds of concrete thing a long draft must name before it
 * counts as answering its own question.
 *
 * Two rather than one because a single filename in forty words is a passing
 * mention; a filename *and* a quoted string *and* a function call is someone
 * who has already said what they mean.
 */
export const SELF_CONTAINED_ANCHORS = 2;

/** Whether a draft is detailed enough to need no help. */
function isSelfContained(draft: string): boolean {
  const words = draft.trim().split(/\s+/).length;
  if (words < LONG_PROMPT_WORDS) return false;
  return anchorVariety(draft) >= SELF_CONTAINED_ANCHORS;
}

/**
 * Decides whether a draft should be offered a clarification.
 *
 * Checks run cheapest-first and each one is a reason to stay quiet:
 *
 * 1. **Empty** — nothing to do.
 * 2. **No history** — on a fresh chat a reference has nothing to resolve
 *    against, so the feature must be silent. This is checked before scanning
 *    because it is a single comparison and it rules out the whole feature.
 * 3. **No vague reference** — the draft says what it means.
 * 4. **Self-contained** — a long, detailed instruction that happens to contain
 *    "this" does not need help. Applied to every reference kind, including the
 *    ones that point outward: a forty-word prompt naming three concrete things
 *    and ending "as discussed earlier" is a prompt whose author knows what they
 *    are asking. Suppressing it is the restrained call, and Task 4 is where
 *    that judgement gets revisited against real usage rather than taste.
 */
export function needsClarification(
  draft: string,
  options: ClarifyCheckOptions,
): ClarifyCheck {
  if (draft.trim() === '') return { needed: false, reason: 'empty' };

  if (options.priorTurns <= 0) return { needed: false, reason: 'no-history' };

  const references = findVagueReferences(draft);
  if (references.length === 0) return { needed: false, reason: 'no-reference' };

  if (isSelfContained(draft)) return { needed: false, reason: 'self-contained' };

  return { needed: true, references };
}
