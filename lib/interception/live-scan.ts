import { detect } from '../detector/engine';
import { ALL_RULES } from '../detector/rules';
import type { Finding, Rule } from '../detector/types';
import type { Settings } from '../policy/schema';
import type { Disposer, SiteAdapter } from '../adapters/types';

/**
 * Live scanning of the composer as the user types.
 *
 * Feeds the always-on risk indicator. The original product concept had the
 * user click a "check my prompt" control before submitting; that was rejected
 * during planning because nobody remembers to press it. Protection that
 * depends on the user thinking of it is protection that does not happen.
 *
 * Purely advisory — this never touches the composer, never cancels anything,
 * and never influences whether a submission is held. Submit-time interception
 * is the gate.
 */

export type RiskLevel = 'none' | 'low' | 'high';

export interface RiskState {
  level: RiskLevel;
  findings: readonly Finding[];
  highCount: number;
  lowCount: number;
}

export interface LiveScannerConfig {
  adapter: SiteAdapter;
  getSettings: () => Settings;
  /** Called when the risk level or finding counts change. */
  onRiskChange: (state: RiskState) => void;
  isAllowlisted?: (value: string) => boolean;
  rules?: readonly Rule[];
  /** Trailing debounce in milliseconds. */
  debounceMs?: number;
  /**
   * Reports a scan that exceeded the performance budget.
   *
   * Receives timing and length only — never the text, never a value. A
   * diagnostic that leaks the thing it is diagnosing would be worse than no
   * diagnostic.
   */
  onSlowScan?: (info: { durationMs: number; length: number }) => void;
}

/** PRD budget: detection must stay under 50ms on a 10KB draft. */
export const SCAN_BUDGET_MS = 50;

const DEFAULT_DEBOUNCE_MS = 250;

const IDLE: RiskState = { level: 'none', findings: [], highCount: 0, lowCount: 0 };

/**
 * FNV-1a, 32-bit.
 *
 * Used to remember what was last scanned WITHOUT retaining the draft itself.
 * Keeping the previous text in a module-level variable would mean holding a
 * long-lived copy of whatever secrets the user typed — precisely the kind of
 * quiet accumulation this product exists to prevent. A hash is enough to know
 * "unchanged" and forgets the content.
 *
 * Not a security primitive: a collision costs one skipped rescan, and the next
 * keystroke corrects it.
 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function levelFor(high: number, low: number): RiskLevel {
  if (high > 0) return 'high';
  if (low > 0) return 'low';
  return 'none';
}

/**
 * Watches the composer and reports a risk level.
 *
 * Returns a disposer, or a no-op disposer if the adapter cannot observe input.
 */
export function createLiveScanner(config: LiveScannerConfig): Disposer {
  const {
    adapter,
    getSettings,
    onRiskChange,
    isAllowlisted,
    rules = ALL_RULES,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    onSlowScan,
  } = config;

  if (!adapter.onInput) return () => {};

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastHash: number | null = null;
  let lastLength = -1;
  let lastState: RiskState = IDLE;

  const emit = (state: RiskState) => {
    // Only surface genuine changes. Re-rendering the badge on every keystroke
    // would make it flicker and would waste work the user cannot perceive.
    if (
      state.level === lastState.level &&
      state.highCount === lastState.highCount &&
      state.lowCount === lastState.lowCount
    ) {
      return;
    }
    lastState = state;
    onRiskChange(state);
  };

  const scan = () => {
    try {
      const settings = getSettings();
      if (!settings.enabled) {
        emit(IDLE);
        return;
      }

      const composer = adapter.getComposer();
      if (!composer) return;

      const text = adapter.getText(composer);

      if (text.trim() === '') {
        lastHash = null;
        lastLength = -1;
        emit(IDLE);
        return;
      }

      // Length is checked alongside the hash so a collision cannot suppress a
      // rescan on text of a different size.
      const currentHash = hash(text);
      if (currentHash === lastHash && text.length === lastLength) return;
      lastHash = currentHash;
      lastLength = text.length;

      const started = performance.now();
      const findings = detect(
        text,
        {
          disabledRuleIds: settings.disabledRuleIds,
          placeholderStyle: settings.placeholderStyle,
          isAllowlisted,
        },
        rules,
      );
      const durationMs = performance.now() - started;

      if (durationMs > SCAN_BUDGET_MS) {
        onSlowScan?.({ durationMs, length: text.length });
      }

      const highCount = findings.filter((f) => f.tier === 'high').length;
      const lowCount = findings.length - highCount;

      emit({ level: levelFor(highCount, lowCount), findings, highCount, lowCount });
    } catch {
      // An advisory indicator failing must never disturb typing. The badge
      // simply stops updating; the submit-time gate is unaffected.
    }
  };

  const dispose = adapter.onInput(() => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(scan, debounceMs);
  });

  return () => {
    if (timer !== undefined) clearTimeout(timer);
    dispose();
  };
}
