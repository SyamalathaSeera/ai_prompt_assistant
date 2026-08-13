import { redact } from '@/lib/detector/engine';
import type { Finding } from '@/lib/detector/types';
import type { HeldSubmission } from '@/lib/interception/controller';

/**
 * State for the injected panel.
 *
 * Kept out of the component so the guarantee that matters can be tested
 * directly: **no reachable state leaves a held submission stranded**. Once a
 * submission is cancelled, every exit from this store either sends it or hands
 * control back to the user with their text intact. A prompt the user can
 * neither send nor recover is the worst outcome this product can produce.
 */

export type Phase = 'reviewing' | 'editing' | 'applying';

export type PanelState =
  | { kind: 'idle' }
  | {
      kind: 'active';
      submission: HeldSubmission;
      /**
       * Which placeholders the user has chosen to redact.
       *
       * Keyed by placeholder rather than by finding, so toggling a value that
       * appears three times toggles all three. They are one decision.
       */
      selection: Readonly<Record<string, boolean>>;
      /** The prompt with the currently selected redactions applied. */
      redactedText: string;
      /** Working copy while editing. */
      draft: string;
      phase: Phase;
    };

export interface PanelStoreConfig {
  /**
   * Called when the user permanently allowlists a value.
   *
   * Async and impure — hashing and storage live outside the detector, per
   * ADR-004. Wired to real storage in milestone 0.0.6.0.
   */
  onAllowlist?: (value: string) => void;
}

export interface PanelStore {
  get(): PanelState;
  subscribe(listener: (state: PanelState) => void): () => void;
  present(submission: HeldSubmission): void;
  /** Include or exclude one value from redaction. */
  toggle(placeholder: string): void;
  /** Never flag this value again, and stop redacting it here. */
  allowlist(placeholder: string): void;
  sendRedacted(): void;
  sendOriginal(): void;
  startEditing(): void;
  updateDraft(draft: string): void;
  sendEdited(): void;
  /** Dismiss without sending. The composer keeps the user's text. */
  dismiss(): void;
}

const IDLE: PanelState = { kind: 'idle' };

/** Applies only the findings the user has left selected. */
function redactSelected(
  submission: HeldSubmission,
  selection: Readonly<Record<string, boolean>>,
): string {
  const chosen = submission.findings.filter((f) => selection[f.placeholder] !== false);
  return redact(submission.text, chosen).text;
}

/** The value a placeholder stands for, read back out of the original text. */
function valueFor(submission: HeldSubmission, placeholder: string): string | null {
  const finding = submission.findings.find((f) => f.placeholder === placeholder);
  if (!finding) return null;
  return submission.text.slice(finding.start, finding.end);
}

export function createPanelStore(config: PanelStoreConfig = {}): PanelStore {
  let state: PanelState = IDLE;
  const listeners = new Set<(state: PanelState) => void>();

  const set = (next: PanelState) => {
    state = next;
    listeners.forEach((listener) => listener(next));
  };

  /** Re-derives the redacted text after a selection change. */
  const withSelection = (
    active: Extract<PanelState, { kind: 'active' }>,
    selection: Record<string, boolean>,
  ): PanelState => {
    const redactedText = redactSelected(active.submission, selection);
    return {
      ...active,
      selection,
      redactedText,
      // Only re-seed the draft while reviewing. Overwriting the user's
      // in-progress edit because they toggled a checkbox would be maddening.
      draft: active.phase === 'editing' ? active.draft : redactedText,
    };
  };

  /**
   * Runs a terminal action exactly once.
   *
   * Guards against a double click on Send, and against acting on a submission
   * that has already been resolved — both of which would call `release()`
   * twice and send the prompt twice.
   */
  const finish = (action: (active: Extract<PanelState, { kind: 'active' }>) => void) => {
    if (state.kind !== 'active') return;
    if (state.phase === 'applying') return;

    const active = state;
    set({ ...active, phase: 'applying' });

    try {
      action(active);
    } finally {
      // Always return to idle. If the action threw, the interception
      // controller's own fail-open path releases the submission; leaving the
      // modal open over a released prompt would be worse than closing it.
      set(IDLE);
    }
  };

  return {
    get: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    present(submission) {
      // Everything starts selected. The safe choice must be the default one.
      const selection: Record<string, boolean> = {};
      for (const finding of submission.findings) {
        selection[finding.placeholder] = true;
      }

      const redactedText = redactSelected(submission, selection);
      set({
        kind: 'active',
        submission,
        selection,
        redactedText,
        draft: redactedText,
        phase: 'reviewing',
      });
    },

    toggle(placeholder) {
      if (state.kind !== 'active' || state.phase === 'applying') return;
      const selection = {
        ...state.selection,
        [placeholder]: state.selection[placeholder] === false,
      };
      set(withSelection(state, selection));
    },

    allowlist(placeholder) {
      if (state.kind !== 'active' || state.phase === 'applying') return;

      const value = valueFor(state.submission, placeholder);
      if (value !== null) config.onAllowlist?.(value);

      // Also stop redacting it here. Allowlisting means "this is fine" — it
      // would be incoherent to record that and still replace it in this
      // prompt.
      set(withSelection(state, { ...state.selection, [placeholder]: false }));
    },

    sendRedacted() {
      finish((active) => active.submission.sendReplacement(active.redactedText));
    },

    sendOriginal() {
      finish((active) => active.submission.sendOriginal());
    },

    startEditing() {
      if (state.kind !== 'active' || state.phase === 'applying') return;
      set({ ...state, phase: 'editing' });
    },

    updateDraft(draft) {
      if (state.kind !== 'active' || state.phase !== 'editing') return;
      set({ ...state, draft });
    },

    sendEdited() {
      finish((active) => active.submission.sendReplacement(active.draft));
    },

    /**
     * Dismiss without sending.
     *
     * Deliberately does NOT send. Escape and the close button are dismissal
     * gestures, and a security tool that transmits secrets when the user waves
     * it away has the default exactly backwards.
     *
     * Nothing is lost: the submission was cancelled before it left, so the
     * user's text is still sitting in the composer to edit or re-send.
     */
    dismiss() {
      if (state.kind !== 'active' || state.phase === 'applying') return;
      state.submission.cancel();
      set(IDLE);
    },
  };
}

/** Findings grouped to one row per distinct value, in reading order. */
export interface FindingRow {
  placeholder: string;
  label: string;
  tier: 'high' | 'low';
  /** Masked preview of the value. */
  masked: string;
  /** How many times this value appears in the prompt. */
  occurrences: number;
  selected: boolean;
}

/**
 * One row per distinct value, not per occurrence.
 *
 * A key pasted three times is one decision for the user to make, so showing it
 * three times would be three chances to get confused for no added information.
 */
export function toRows(
  submission: HeldSubmission,
  selection: Readonly<Record<string, boolean>>,
  mask: (value: string) => string,
): FindingRow[] {
  const byPlaceholder = new Map<string, { finding: Finding; count: number }>();

  for (const finding of submission.findings) {
    const existing = byPlaceholder.get(finding.placeholder);
    if (existing) {
      existing.count += 1;
    } else {
      byPlaceholder.set(finding.placeholder, { finding, count: 1 });
    }
  }

  return [...byPlaceholder.values()].map(({ finding, count }) => ({
    placeholder: finding.placeholder,
    label: finding.label,
    tier: finding.tier,
    masked: mask(submission.text.slice(finding.start, finding.end)),
    occurrences: count,
    selected: selection[finding.placeholder] !== false,
  }));
}
