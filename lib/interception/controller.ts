import { detect } from '../detector/engine';
import { ALL_RULES } from '../detector/rules';
import type { Finding, Rule } from '../detector/types';
import type { Settings } from '../policy/schema';
import type { Disposer, SiteAdapter, SubmitIntent } from '../adapters/types';

/**
 * Submit interception.
 *
 * Sits between the adapter (which knows the page) and the approval UI (which
 * knows the user). Its job on every submission is to answer one question —
 * does this prompt contain something that should not leave the machine — and
 * to get out of the way instantly when the answer is no.
 *
 * FAIL OPEN is the governing rule here, and the control flow is arranged
 * around it: all the work that could throw happens BEFORE the event is
 * cancelled, and if the UI callback throws after cancellation the submission
 * is released immediately. Trapping someone's prompt because of a bug in our
 * code is worse than any secret this tool might miss — a user who cannot send
 * messages uninstalls within minutes, and then they are protected by nothing.
 */

export interface HeldSubmission {
  /** The composer's text at the moment of submission. */
  text: string;
  /** Everything detected, both tiers, in reading order. */
  findings: readonly Finding[];
  /** High-tier findings only — the ones that caused the hold. */
  blocking: readonly Finding[];
  /**
   * Whether submission was actually cancelled.
   *
   * False in `warn` mode, where the user has chosen to be told without being
   * stopped. The send functions below are no-ops in that case, since the
   * prompt is already on its way.
   */
  held: boolean;
  /** Send exactly what the user typed, unchanged. */
  sendOriginal: () => void;
  /** Replace the composer contents, then send. */
  sendReplacement: (replacement: string) => void | Promise<void>;
  /** Abandon the submission and leave the composer untouched for editing. */
  cancel: () => void;
}

export interface InterceptorConfig {
  adapter: SiteAdapter;
  /**
   * Current settings, read synchronously.
   *
   * A getter rather than a snapshot so a settings change takes effect on the
   * next submission without re-registering listeners or reloading the page.
   */
  getSettings: () => Settings;
  /** Called when a submission is held (or, in warn mode, allowed with notice). */
  onHeld: (submission: HeldSubmission) => void;
  /** Suppresses allowlisted values. Supplied by the caller — see ADR-004. */
  isAllowlisted?: (value: string) => boolean;
  /** Injectable for testing; defaults to the full registry. */
  rules?: readonly Rule[];
}

/**
 * Whether protection is currently suspended for this host.
 *
 * Two mechanisms: a permanent per-host pause, and a global timed pause that
 * expires on its own. The timed one is compared against the clock on every
 * check rather than being cleared by a timer, so it cannot outlive its window
 * because a service worker was asleep when it should have fired.
 */
export function isPaused(settings: Settings, hostname: string, now = Date.now()): boolean {
  if (settings.pausedUntil !== null && now < settings.pausedUntil) return true;

  const host = hostname.toLowerCase().replace(/^www\./, '');
  return settings.pausedHosts.some((h) => host === h.toLowerCase());
}

/**
 * Wires an adapter's submit intents to the detector.
 *
 * Returns a disposer that detaches every listener.
 */
export function createInterceptor(config: InterceptorConfig): Disposer {
  const { adapter, getSettings, onHeld, isAllowlisted, rules = ALL_RULES } = config;

  const handleIntent = (intent: SubmitIntent): void => {
    let cancelled = false;

    try {
      const settings = getSettings();

      // Kill switch and per-host pause. Checked first so a disabled extension
      // costs a boolean read and nothing else.
      if (!settings.enabled) return;
      if (isPaused(settings, location.hostname)) return;

      const composer = adapter.getComposer();
      // A missing composer is a normal condition, not an error — the page may
      // be mid-navigation. Never block on it.
      if (!composer) return;

      const text = adapter.getText(composer);
      if (text.trim() === '') return;

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
      // Nothing blocking: the submission proceeds untouched, having cost one
      // synchronous scan. This is the overwhelmingly common path.
      if (blocking.length === 0) return;

      const shouldHold = settings.highTierBehavior === 'block';

      if (shouldHold) {
        intent.event.preventDefault();
        intent.event.stopPropagation();
        cancelled = true;
      }

      const submission: HeldSubmission = {
        text,
        findings,
        blocking,
        held: cancelled,
        sendOriginal: () => {
          if (cancelled) intent.release();
        },
        sendReplacement: (replacement: string) => {
          if (!cancelled) return;
          const target = adapter.getComposer();
          if (!target) return;
          adapter.setText(target, replacement);
          intent.release();
        },
        cancel: () => {
          /* already prevented; leave the composer for the user to edit */
        },
      };

      try {
        onHeld(submission);
      } catch {
        // The approval UI failed. Releasing is the only acceptable response —
        // the alternative is a prompt the user can never send.
        if (cancelled) intent.release();
      }
    } catch {
      // Anything above threw before the event was cancelled, so the host page
      // proceeds exactly as if this extension were not installed. If we had
      // already cancelled, release rather than strand the submission.
      if (cancelled) {
        try {
          intent.release();
        } catch {
          /* nothing further we can safely do */
        }
      }
    }
  };

  return adapter.onSubmitIntent(handleIntent);
}
