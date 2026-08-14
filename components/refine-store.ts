import { refine, DEFAULT_STYLE, type RefinementStyle } from '@/lib/refine';
import type { Rule } from '@/lib/detector/types';

/**
 * State for prompt refinement.
 *
 * Separate from the approval modal's store and the risk badge's, for the same
 * reason those are separate from each other: they answer different questions
 * at different times, and merging them would mean every keystroke re-rendering
 * a state machine that has nothing to do with it.
 */

export type RefinePhase =
  /** Nothing happening. */
  | 'idle'
  /** Waiting on the model. */
  | 'working'
  /** A suggestion is ready for review. */
  | 'reviewing'
  /** Something went wrong, or there was nothing to change. */
  | 'failed';

export interface RefineState {
  phase: RefinePhase;
  /** The draft as it was when refinement started. */
  original: string;
  /** The model's suggestion, with the user's real values restored. */
  suggestion: string;
  /** Editable copy while the user adjusts the suggestion. */
  draft: string;
  /** True once the user has edited the suggestion by hand. */
  edited: boolean;
  style: RefinementStyle;
  message: string;
}

const IDLE: RefineState = {
  phase: 'idle',
  original: '',
  suggestion: '',
  draft: '',
  edited: false,
  style: DEFAULT_STYLE,
  message: '',
};

export interface RefineStoreConfig {
  /** Reads the composer's current text. */
  getDraft: () => string;
  /** Writes accepted text back to the composer. */
  applyToComposer: (text: string) => void;
  /** Current settings that affect detection. */
  getDisabledRuleIds?: () => readonly string[];
  /** The style the user last chose, from settings. */
  initialStyle?: RefinementStyle;
  /** Remembers the chosen style across sessions. */
  onStyleChange?: (style: RefinementStyle) => void;
  rules?: readonly Rule[];
}

export interface RefineStore {
  get(): RefineState;
  subscribe(listener: (state: RefineState) => void): () => void;
  /** Runs a refinement. Explicit user action only. */
  start(style?: RefinementStyle): Promise<void>;
  /** Cancels an in-flight refinement. */
  cancel(): void;
  setStyle(style: RefinementStyle): void;
  updateDraft(text: string): void;
  /** Writes the suggestion into the composer. Does NOT submit. */
  accept(): void;
  /** Discards the suggestion; the composer is untouched. */
  dismiss(): void;
  /** Puts back what the user had before accepting. */
  undo(): void;
}

export function createRefineStore(config: RefineStoreConfig): RefineStore {
  let state: RefineState = { ...IDLE, style: config.initialStyle ?? DEFAULT_STYLE };
  let listeners = new Set<(state: RefineState) => void>();
  let controller: AbortController | null = null;

  /**
   * What the composer held before an accept.
   *
   * Accepting must be undoable until the prompt is sent. Someone who accepts a
   * rewrite, reads it properly, and dislikes it should not have to reconstruct
   * their own wording from memory.
   */
  let undoBuffer: string | null = null;

  const set = (next: RefineState) => {
    state = next;
    listeners.forEach((listener) => listener(next));
  };

  /**
   * Back to nothing-happening, keeping the chosen style.
   *
   * Resetting to the bare default here would silently undo the user's choice
   * every time they accepted or dismissed a suggestion — the setting would
   * appear to save and then not.
   */
  const idle = (): RefineState => ({ ...IDLE, style: state.style });

  return {
    get: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners = new Set([...listeners].filter((l) => l !== listener));
      };
    },

    async start(style) {
      // Refinement never runs on its own. Rewriting what someone typed without
      // being asked is presumptuous, and unlike redaction there is no safety
      // argument for doing it uninvited.
      const chosen = style ?? state.style;
      const original = config.getDraft();

      if (original.trim() === '') {
        set({ ...IDLE, style: chosen, phase: 'failed', message: 'Type something first.' });
        return;
      }

      controller?.abort();
      controller = new AbortController();
      const active = controller;

      set({
        ...IDLE,
        style: chosen,
        phase: 'working',
        original,
        message: '',
      });

      const result = await refine(original, {
        style: chosen,
        signal: active.signal,
        disabledRuleIds: config.getDisabledRuleIds?.(),
        rules: config.rules,
      });

      // A newer request superseded this one, or the user cancelled.
      if (active !== controller) return;
      controller = null;

      if (!result.ok) {
        // Cancellation is the user's own action and needs no report.
        if (result.reason === 'aborted') {
          set(idle());
          return;
        }
        set({
          ...IDLE,
          style: chosen,
          phase: 'failed',
          original,
          message: result.message,
        });
        return;
      }

      set({
        phase: 'reviewing',
        original,
        suggestion: result.text,
        draft: result.text,
        edited: false,
        style: chosen,
        message: '',
      });
    },

    cancel() {
      controller?.abort();
      controller = null;
      set(idle());
    },

    setStyle(style) {
      config.onStyleChange?.(style);
      set({ ...state, style });
    },

    updateDraft(text) {
      if (state.phase !== 'reviewing') return;
      set({ ...state, draft: text, edited: text !== state.suggestion });
    },

    accept() {
      if (state.phase !== 'reviewing') return;

      // Captured before writing, so undo restores what was actually there
      // rather than what we assume was there.
      undoBuffer = config.getDraft();
      config.applyToComposer(state.draft);
      set(idle());
    },

    dismiss() {
      controller?.abort();
      controller = null;
      set(idle());
    },

    undo() {
      if (undoBuffer === null) return;
      config.applyToComposer(undoBuffer);
      undoBuffer = null;
      set(idle());
    },
  };
}
