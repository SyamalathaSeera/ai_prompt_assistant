import type { Finding } from '@/lib/detector/types';
import type { RiskLevel } from '@/lib/interception/live-scan';

/**
 * State for the always-on risk indicator.
 *
 * Deliberately separate from the approval modal's store. The two are
 * orthogonal — risk tracks whatever is currently in the composer, while the
 * modal exists only for a held submission — and folding them together would
 * mean every badge update re-rendered the modal's state machine.
 */

export interface RiskSnapshot {
  level: RiskLevel;
  findings: readonly Finding[];
  /** The composer text the findings were computed from. */
  text: string;
  /** Whether the user has opened the details popover. */
  open: boolean;
}

export interface RiskStoreConfig {
  /**
   * Rewrites the composer with redacted text, WITHOUT submitting.
   *
   * The whole point of the badge is to let someone clean up a draft before
   * they send it, on their own initiative rather than in response to being
   * interrupted.
   */
  onApplyRedaction?: (text: string) => void;
}

export interface RiskStore {
  get(): RiskSnapshot;
  subscribe(listener: (snapshot: RiskSnapshot) => void): () => void;
  /** Called by the live scanner when the draft's risk changes. */
  setRisk(level: RiskLevel, findings: readonly Finding[], text: string): void;
  open(): void;
  close(): void;
  /** Apply redactions to the composer and close. Never submits. */
  applyRedaction(redacted: string): void;
}

const EMPTY: RiskSnapshot = { level: 'none', findings: [], text: '', open: false };

export function createRiskStore(config: RiskStoreConfig = {}): RiskStore {
  let snapshot: RiskSnapshot = EMPTY;
  const listeners = new Set<(snapshot: RiskSnapshot) => void>();

  const set = (next: RiskSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener(next));
  };

  return {
    get: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setRisk(level, findings, text) {
      // Closing on every keystroke would fight the user, but a popover left
      // open over a draft that no longer has any risk is just confusing.
      const open = level === 'none' ? false : snapshot.open;
      set({ level, findings, text, open });
    },

    open() {
      if (snapshot.level === 'none') return;
      set({ ...snapshot, open: true });
    },

    close() {
      if (!snapshot.open) return;
      set({ ...snapshot, open: false });
    },

    applyRedaction(redacted) {
      config.onApplyRedaction?.(redacted);
      set({ ...snapshot, open: false });
    },
  };
}
