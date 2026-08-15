import { assembleContext, needsClarification } from '@/lib/clarify';
// Imported from its own module rather than the barrel: this is the one door
// in `lib/clarify/` that opens onto the model layer, and it should be visible
// here that we are walking through it.
import { interpret } from '@/lib/clarify/interpret';
import { prepareForModel } from '@/lib/refine/guard';
import type { ContextTurn, Resolution } from '@/lib/clarify';
import type { Rule } from '@/lib/detector/types';

/**
 * State for clarify-with-context.
 *
 * The governing rule, and the one every method here is arranged around:
 * **nothing reaches the composer without the user saying yes.** An automatic
 * rewrite of what someone meant is a worse failure than a redaction error,
 * because it is invisible — the prompt still reads like something they might
 * have written, so there is no moment where they notice.
 *
 * So `accept()` is the only method that writes, and it only runs from a click.
 * Declining is not a soft no: the draft is remembered, and the same text is
 * never offered a second time.
 */

export type ClarifyPhase =
  /** Nothing happening. */
  | 'idle'
  /** Reading the conversation and asking the model. */
  | 'working'
  /** An interpretation is waiting for a yes or no. */
  | 'asking';

/** One thing the interpretation resolved, and where it came from. */
export interface ClarifySource {
  /** The phrase the rewrite introduced. */
  text: string;
  role: 'user' | 'assistant';
  /** Index of the turn, for pointing at the message on the page. */
  turnIndex: number;
  turnId: string | null;
  /** A short, redacted quote from that turn. */
  excerpt: string;
}

export interface ClarifyState {
  phase: ClarifyPhase;
  /** The draft as it was when we asked. */
  original: string;
  /** The interpretation, with the user real values restored. */
  suggestion: string;
  /** Editable copy while the user adjusts it. */
  draft: string;
  edited: boolean;
  sources: readonly ClarifySource[];
}

const IDLE: ClarifyState = {
  phase: 'idle',
  original: '',
  suggestion: '',
  draft: '',
  edited: false,
  sources: [],
};

export interface ClarifyStoreConfig {
  getDraft: () => string;
  /** Writes a confirmed interpretation back to the composer. */
  applyToComposer: (text: string) => void;
  /** Prior turns from the adapter. Absent on platforms that decline to read. */
  getTurns?: () => readonly ContextTurn[];
  getConversationId?: () => string | null;
  getDisabledRuleIds?: () => readonly string[];
  rules?: readonly Rule[];
}

export interface ClarifyStore {
  get(): ClarifyState;
  subscribe(listener: (state: ClarifyState) => void): () => void;
  /** Looks at the current draft and offers an interpretation if one is warranted. */
  consider(): Promise<void>;
  /** Yes: writes the interpretation to the composer. Never submits. */
  accept(): void;
  /** No: the composer is untouched, and this draft is never offered again. */
  decline(): void;
  updateDraft(text: string): void;
  /** Drops an in-flight or pending offer without recording a decline. */
  cancel(): void;
  /** Whether this draft has already been declined. */
  hasDeclined(draft: string): boolean;
}

/**
 * How many declined drafts to remember.
 *
 * Bounded because it is per-page state that lives as long as the tab. Small,
 * because its only job is "do not ask about this again" for the draft in front
 * of the user — not to build a history of what they turned down.
 */
const DECLINE_MEMORY = 20;

/**
 * How many unaccepted offers a conversation gets before we stop offering.
 *
 * Two, then silence for the rest of the conversation. The failure mode for this
 * feature is not being wrong — it is being *frequent*. Someone who has ignored
 * or rejected two interpretations has told us what they think of them, and a
 * third is not a suggestion any more, it is nagging.
 *
 * Counted per conversation rather than globally, because a new chat is a new
 * context and the reference patterns in it may be entirely different. Reset by
 * a single acceptance: that is the signal the offers are landing.
 */
const MAX_UNACCEPTED_OFFERS = 2;

/** How much of a turn to quote as provenance. */
const EXCERPT_CHARS = 120;

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A short quote from the turn a resolution came from, with secrets removed.
 *
 * The text is already on the user screen, so quoting it reveals nothing new.
 * It is redacted anyway: this string ends up in our own DOM, and a product
 * whose claim is that it does not put your secrets anywhere should not make an
 * exception for its own UI.
 */
function excerptFrom(
  turnText: string,
  phrase: string,
  options: { disabledRuleIds?: readonly string[]; rules?: readonly Rule[] },
): string {
  const safe = prepareForModel(turnText, options).text;

  const at = safe.toLowerCase().indexOf(phrase.toLowerCase().split(/\s+/)[0] ?? '');
  if (at < 0) {
    return safe.length > EXCERPT_CHARS ? `${safe.slice(0, EXCERPT_CHARS)}…` : safe;
  }

  const start = Math.max(0, at - EXCERPT_CHARS / 3);
  const end = Math.min(safe.length, start + EXCERPT_CHARS);

  return `${start > 0 ? '…' : ''}${safe.slice(start, end).trim()}${end < safe.length ? '…' : ''}`;
}

export function createClarifyStore(config: ClarifyStoreConfig): ClarifyStore {
  let state: ClarifyState = IDLE;
  let listeners = new Set<(state: ClarifyState) => void>();
  let controller: AbortController | null = null;

  /** Drafts the user has said no to. Never offered again. */
  let declined: string[] = [];

  /** conversation id -> offers shown since the last acceptance. */
  const offers = new Map<string, number>();

  const scope = () => config.getConversationId?.() ?? 'unsaved';

  const set = (next: ClarifyState) => {
    state = next;
    listeners.forEach((listener) => listener(next));
  };

  const remember = (draft: string) => {
    const key = normalise(draft);
    if (key === '' || declined.includes(key)) return;
    declined = [...declined, key].slice(-DECLINE_MEMORY);
  };

  const toSource = (
    resolution: Resolution,
    turns: readonly ContextTurn[],
  ): ClarifySource => ({
    text: resolution.text,
    role: resolution.role,
    turnIndex: resolution.turnIndex,
    turnId: resolution.turnId,
    excerpt: excerptFrom(turns[resolution.turnIndex]?.text ?? '', resolution.text, {
      disabledRuleIds: config.getDisabledRuleIds?.(),
      rules: config.rules,
    }),
  });

  return {
    get: () => state,

    /** Own identity per subscription — see `panel-store.ts` for why. */
    subscribe(listener) {
      const entry = (next: ClarifyState) => listener(next);
      listeners.add(entry);
      return () => {
        listeners = new Set([...listeners].filter((l) => l !== entry));
      };
    },

    hasDeclined(draft) {
      return declined.includes(normalise(draft));
    },

    async consider() {
      const original = config.getDraft();

      // Already answered for this text. Asking again would be nagging, and it
      // is the fastest way to make someone turn a feature off.
      if (declined.includes(normalise(original))) return;

      // Two unaccepted offers in this conversation is an answer. Checked before
      // any work, so a rate-limited conversation costs nothing at all — not a
      // scan, not a context assembly, and certainly not a model call.
      if ((offers.get(scope()) ?? 0) >= MAX_UNACCEPTED_OFFERS) return;

      const turns = config.getTurns?.() ?? [];

      // The cheap gate, before anything expensive. Most drafts stop here.
      const check = needsClarification(original, { priorTurns: turns.length });
      if (!check.needed) return;

      const assembled = assembleContext(turns, {
        conversationId: config.getConversationId?.() ?? null,
        disabledRuleIds: config.getDisabledRuleIds?.(),
        rules: config.rules,
      });
      if (!assembled.ok) return;

      controller?.abort();
      controller = new AbortController();
      const active = controller;

      set({ ...IDLE, phase: 'working', original });

      const result = await interpret(
        original,
        assembled.context,
        check.references,
        turns,
        {
          signal: active.signal,
          disabledRuleIds: config.getDisabledRuleIds?.(),
          rules: config.rules,
        },
      );

      // Superseded or cancelled.
      if (active !== controller) return;
      controller = null;

      /*
       * The draft moved while we were thinking.
       *
       * Offering an interpretation of text the user has already changed is
       * worse than offering nothing: the question refers to words that are no
       * longer on screen.
       */
      if (config.getDraft() !== original) {
        set(IDLE);
        return;
      }

      /*
       * Every failure is silent.
       *
       * This is an offer, not a request the user made. There is no message,
       * no error state, and nothing to dismiss — a clarification that could
       * not be produced should cost exactly nothing.
       */
      if (!result.ok) {
        set(IDLE);
        return;
      }

      // Counted when the offer is SHOWN, not when it is refused. An offer the
      // user scrolled past without engaging is still an offer they did not
      // want, and only counting explicit declines would let the feature keep
      // interrupting someone who is quietly ignoring it.
      offers.set(scope(), (offers.get(scope()) ?? 0) + 1);

      set({
        phase: 'asking',
        original,
        suggestion: result.text,
        draft: result.text,
        edited: false,
        sources: result.resolutions.map((resolution) => toSource(resolution, turns)),
      });
    },

    updateDraft(text) {
      if (state.phase !== 'asking') return;
      set({ ...state, draft: text, edited: text !== state.suggestion });
    },

    accept() {
      // The only path that writes to the composer, and it only runs from a
      // click. Accepting does NOT submit: the user confirmed an interpretation,
      // not that they were finished.
      if (state.phase !== 'asking') return;
      config.applyToComposer(state.draft);
      // An acceptance says the offers are landing, so the budget starts again.
      offers.set(scope(), 0);
      set(IDLE);
    },

    decline() {
      // The composer is deliberately not touched. Whatever the user typed is
      // what gets sent, character for character.
      controller?.abort();
      controller = null;
      remember(state.phase === 'idle' ? config.getDraft() : state.original);
      set(IDLE);
    },

    cancel() {
      controller?.abort();
      controller = null;
      set(IDLE);
    },
  };
}
