import { detect } from '../detector/engine';
import { ALL_RULES } from '../detector/rules';
import type { Finding, Rule } from '../detector/types';
import type { Settings } from '../policy/schema';
import type { Disposer, SiteAdapter } from '../adapters/types';

/**
 * Paste-time early warning.
 *
 * Paste is where the risk actually originates — someone dumping a `.env`, a
 * stack trace, or a config block into the chat. Catching it here means telling
 * the user while they still have the context in mind, instead of interrupting
 * them later at the moment they press send.
 *
 * This never blocks. Nothing has left the machine by pasting into a textbox,
 * and cancelling a paste would risk breaking the feature entirely for no
 * security benefit. Submission is the gate; this is the heads-up.
 */

/**
 * Above this size, paste-time scanning is skipped.
 *
 * Detection runs at roughly 0.4ms per 10KB, so a multi-megabyte paste would
 * cost hundreds of milliseconds on the main thread and produce a visible
 * stall. Skipping is safe precisely because this is an early warning and not
 * the guarantee: submit-time interception still scans the full prompt before
 * anything can leave. Given the choice between a janky tab and a slightly
 * later warning, the later warning wins.
 *
 * Revisit in milestone 0.2.0.4, which owns the performance budget and can
 * chunk the scan properly.
 */
export const MAX_PASTE_SCAN_LENGTH = 512 * 1024;

export interface PasteRisk {
  /** The pasted text — the chunk alone, not the whole composer. */
  text: string;
  findings: readonly Finding[];
  /** High-tier findings only. */
  blocking: readonly Finding[];
  /** True when the paste exceeded the scan cap and was not examined. */
  skippedForSize: boolean;
}

export interface PasteWatcherConfig {
  adapter: SiteAdapter;
  getSettings: () => Settings;
  /** Called when a paste contains something worth surfacing. */
  onRisk: (risk: PasteRisk) => void;
  isAllowlisted?: (value: string) => boolean;
  rules?: readonly Rule[];
}

/**
 * Watches for pastes into the composer and reports risk.
 *
 * Returns a disposer, or a no-op disposer if the adapter does not support
 * paste observation.
 */
export function createPasteWatcher(config: PasteWatcherConfig): Disposer {
  const { adapter, getSettings, onRisk, isAllowlisted, rules = ALL_RULES } = config;

  if (!adapter.onPaste) return () => {};

  return adapter.onPaste(({ text }) => {
    try {
      const settings = getSettings();
      if (!settings.enabled) return;
      if (!settings.scanOnPaste) return;

      if (text.length > MAX_PASTE_SCAN_LENGTH) {
        onRisk({
          text,
          findings: [],
          blocking: [],
          skippedForSize: true,
        });
        return;
      }

      // Deferred to a macrotask so the paste itself completes first and the
      // caret lands where the user expects, regardless of scan cost.
      setTimeout(() => {
        try {
          const findings = detect(
            text,
            {
              disabledRuleIds: settings.disabledRuleIds,
              placeholderStyle: settings.placeholderStyle,
              isAllowlisted,
            },
            rules,
          );

          const blocking = findings.filter((f) => f.tier === 'high');
          if (blocking.length === 0) return;

          onRisk({ text, findings, blocking, skippedForSize: false });
        } catch {
          /* an early warning failing must never disturb the page */
        }
      }, 0);
    } catch {
      /* likewise */
    }
  });
}
