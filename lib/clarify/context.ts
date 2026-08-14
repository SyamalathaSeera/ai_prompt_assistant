import { prepareForModel } from '../refine/guard';
import type { Finding, Rule } from '../detector/types';

/**
 * Conversation context assembly.
 *
 * Gathers the turns a vague reference might be pointing at, and hands back
 * something safe to put in front of a model.
 *
 * **The secret this file is guarding against is not the user's draft.** The
 * draft is already redacted by the time refinement or clarification runs. The
 * new exposure here is the *conversation*: turns the user sent before
 * installing this extension, or approved deliberately at the time, or that the
 * assistant echoed back. Reading them into a model prompt would quietly
 * re-introduce every secret the product exists to keep out of one. So the
 * assembled context goes through the same redaction path as a draft — see
 * `refine/guard.ts` for why that ordering is not negotiable.
 *
 * Pure, like the rest of `lib/clarify/`: turns in, text out. Reading the DOM
 * is the adapter's job and stays there.
 */

/**
 * One conversation turn.
 *
 * A structural subset of the adapter's `ChatMessage`, so an adapter's output
 * is assignable directly — without this module importing anything that knows
 * what an `HTMLElement` is.
 */
export interface ContextTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Stable per-message id from the host page, when it exposes one. */
  id: string | null;
}

/** A turn that made it into the assembled context. */
export interface IncludedTurn {
  role: 'user' | 'assistant';
  id: string | null;
  /**
   * Index in the array that was passed in.
   *
   * Deliberately the only handle on the turn's content. Task 3 has to show the
   * user *which* turn a reference resolved against, and pointing at the real
   * message on the page — which they can already see — is both better UX and
   * one fewer copy of their conversation held in memory.
   */
  index: number;
}

export interface AssembledContext {
  /**
   * The conversation this came from.
   *
   * Carried on the value rather than assumed by the caller, so context cannot
   * be handed to a different chat without the mismatch being visible. Same
   * reasoning as the vault's per-conversation scoping.
   */
  conversationId: string;
  /** Redacted. The only field that may be shown to a model. */
  text: string;
  /** Turns included, oldest first, in the order they appear in `text`. */
  turns: readonly IncludedTurn[];
  /** How many turns were left out to stay inside the budget. */
  omittedTurns: number;
  /** placeholder -> real value, for restoring locally afterwards. */
  map: Readonly<Record<string, string>>;
  /** What was redacted out of the context. */
  findings: readonly Finding[];
}

export type ContextSkipReason =
  /** A fresh chat with no id yet: there is nothing to scope context to. */
  | 'no-conversation'
  /** No usable prior turns. */
  | 'no-turns'
  /** Even the most recent turn alone exceeds the budget. */
  | 'turns-too-large';

export type ContextResult =
  | { ok: true; context: AssembledContext }
  | { ok: false; reason: ContextSkipReason };

/**
 * Roughly how many tokens of conversation may be assembled.
 *
 * On-device context windows are small — a few thousand tokens total, shared
 * with the instruction and the draft — so this is a reservation, not a limit
 * we expect to be generous. Recency does most of the work anyway: a
 * demonstrative points at something said recently far more often than at
 * something twenty turns back.
 *
 * The authoritative length check lives in the model layer, which measures
 * against the real window and returns `too-long` as a value. This budget only
 * has to stop us assembling something obviously hopeless.
 */
export const CONTEXT_TOKEN_BUDGET = 1000;

/**
 * Hard cap on turns, independent of the token budget.
 *
 * Bounds the work on a conversation hundreds of messages long, and reflects
 * the same recency argument: the twentieth turn back is almost never the
 * antecedent, and including it dilutes the ones that are.
 */
export const MAX_CONTEXT_TURNS = 12;

/**
 * Token estimate from character count.
 *
 * Four characters per token is the usual English approximation. It is an
 * estimate and is treated as one — nothing here reports it to the user or
 * fails a request on it. Its only job is choosing how many whole turns to
 * gather before the model layer does the real measurement.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const LABELS: Record<ContextTurn['role'], string> = {
  user: 'User',
  assistant: 'Assistant',
};

/** Renders one turn as it will appear in the assembled text. */
function render(turn: ContextTurn): string {
  return `${LABELS[turn.role]}: ${turn.text.trim()}`;
}

export interface AssembleOptions {
  /** From the adapter's `getConversationId()`. Null on a fresh chat. */
  conversationId: string | null;
  budgetTokens?: number;
  maxTurns?: number;
  disabledRuleIds?: readonly string[];
  rules?: readonly Rule[];
}

/**
 * Assembles recent conversation into redacted, model-safe context.
 *
 * Walks backwards from the most recent turn, taking whole turns until the next
 * one would not fit. **Truncation never falls inside a message.** Half a turn
 * is worse context than one fewer turn: it reads as a complete statement while
 * missing the clause that changed its meaning, and a model asked to resolve a
 * reference against it will resolve confidently and wrongly.
 *
 * Only the turns handed in are ever read, and the result is stamped with the
 * conversation they came from. Nothing here can reach another chat.
 */
export function assembleContext(
  turns: readonly ContextTurn[],
  options: AssembleOptions,
): ContextResult {
  const { conversationId } = options;
  if (conversationId === null || conversationId === '') {
    return { ok: false, reason: 'no-conversation' };
  }

  const budget = options.budgetTokens ?? CONTEXT_TOKEN_BUDGET;
  const maxTurns = options.maxTurns ?? MAX_CONTEXT_TURNS;

  // Keep the original index: it is how Task 3 points the user back at the
  // message on the page, so it has to survive filtering.
  const usable = turns
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn }) => turn.text.trim() !== '');

  if (usable.length === 0) return { ok: false, reason: 'no-turns' };

  const chosen: { turn: ContextTurn; index: number }[] = [];
  let spent = 0;

  for (let i = usable.length - 1; i >= 0; i -= 1) {
    if (chosen.length >= maxTurns) break;

    const entry = usable[i]!;
    const cost = estimateTokens(render(entry.turn));

    // The whole turn fits or it is not taken. No mid-message truncation.
    if (spent + cost > budget) break;

    spent += cost;
    chosen.push(entry);
  }

  if (chosen.length === 0) return { ok: false, reason: 'turns-too-large' };

  // Gathered most-recent-first for the budget walk; presented oldest-first so
  // the model reads the conversation in the order it happened.
  chosen.reverse();

  /*
   * Redact the assembled text in ONE pass, not turn by turn.
   *
   * Placeholders are numbered per pass. Redacting each turn separately would
   * mint a `[REDACTED_AWS_KEY_1]` in two different turns for two different
   * keys, and the model would reasonably conclude they were the same value.
   */
  const joined = chosen.map(({ turn }) => render(turn)).join('\n\n');
  const prepared = prepareForModel(joined, {
    disabledRuleIds: options.disabledRuleIds,
    rules: options.rules,
  });

  return {
    ok: true,
    context: {
      conversationId,
      text: prepared.text,
      turns: chosen.map(({ turn, index }) => ({ role: turn.role, id: turn.id, index })),
      omittedTurns: usable.length - chosen.length,
      map: prepared.map,
      findings: prepared.findings,
    },
  };
}

/**
 * Whether assembled context belongs to the conversation about to use it.
 *
 * Cheap, and the only thing standing between a cached context and one chat's
 * content appearing inside another. Callers that hold context across a
 * navigation must check it — an SPA route change swaps the conversation
 * without unloading the content script.
 */
export function isContextFor(
  context: AssembledContext,
  conversationId: string | null,
): boolean {
  return conversationId !== null && context.conversationId === conversationId;
}
