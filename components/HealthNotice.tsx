import { useState } from 'preact/hooks';
import type { HealthLevel } from '@/lib/health';
import type { Anchor } from './useAnchor';

/**
 * "Protection unavailable on this page."
 *
 * The whole point of milestone 0.5.0.0: an extension that has silently stopped
 * working is worse than no extension, because it has replaced a healthy
 * caution with a false sense of safety. Someone who believes their prompts are
 * being checked types things they otherwise would not.
 *
 * So this surface is not an error dialog and does not apologise. It answers one
 * question — *are you protected right now?* — and it is the only place in the
 * product that is allowed to interrupt without the user having done anything,
 * because the alternative is letting them proceed on a false belief.
 *
 * It still never blocks: no backdrop, no focus trap, nothing held. Telling
 * someone their seatbelt is undone should not also lock the doors.
 */

interface Props {
  level: HealthLevel;
  /**
   * Where the composer is, when there is one.
   *
   * **Optional, and that is the important part.** This notice was originally
   * anchored to the composer like every other surface — which meant that when
   * the composer could not be found, there was no anchor, and the message
   * saying so was never rendered. The one state it exists to report was the one
   * state it could not appear in.
   *
   * Found by the end-to-end suite, which removed the composer from a real page
   * and watched nothing happen. No jsdom test would have caught it: they all
   * supplied a composer, because supplying one is what makes a test set up.
   */
  anchor?: Anchor | null;
  /** Shown only in the degraded case, for a bug report. Never transmitted. */
  resolvedVia?: string | null;
}

const HEIGHT = 30;
const GAP = 8;

/** Where to sit when there is no composer to sit above. */
const ORPHAN_TOP = 16;

export function HealthNotice({ level, anchor, resolvedVia }: Props) {
  const [dismissed, setDismissed] = useState(false);

  // Healthy is silent. A badge that says "working" every time you load a page
  // is noise, and noise is what makes the one important message invisible.
  if (level === 'healthy') return null;
  if (dismissed) return null;

  const unavailable = level === 'unavailable';

  return (
    <div
      className="pointer-events-auto fixed flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs shadow-lg"
      data-testid="apa-health-notice"
      data-level={level}
      // `alert` for unavailable, `status` for degraded: one is a change to what
      // the user is protected by, the other is a change to how. A screen reader
      // should interrupt for the first and not for the second.
      role={unavailable ? 'alert' : 'status'}
      style={{
        // Above the composer when there is one; otherwise pinned to the top of
        // the viewport, where it is unmissable and cannot depend on a page
        // element that has just gone missing.
        top: anchor ? `${Math.max(GAP, anchor.top - HEIGHT - GAP)}px` : `${ORPHAN_TOP}px`,
        left: anchor ? `${Math.max(GAP, anchor.left)}px` : `${ORPHAN_TOP}px`,
        maxWidth: `${Math.max(240, anchor?.width ?? 0)}px`,
        background: unavailable ? 'var(--apa-danger-bg)' : 'var(--apa-warn-bg)',
        color: unavailable ? 'var(--apa-danger)' : 'var(--apa-warn)',
        borderColor: 'currentColor',
        boxShadow: 'var(--apa-shadow)',
      }}
    >
      <span aria-hidden="true">{unavailable ? '⚠' : 'ⓘ'}</span>

      <span data-testid="apa-health-message">
        {unavailable
          ? 'Protection unavailable on this page. Nothing is being checked.'
          : 'This page changed. Protection is running, but less precisely than usual.'}
      </span>

      {!unavailable && resolvedVia && (
        // Surfaced so a bug report can say which fallback was in use. It is a
        // strategy name, never anything from the page.
        <code data-testid="apa-health-via" className="opacity-70">
          {resolvedVia}
        </code>
      )}

      <button
        type="button"
        data-testid="apa-health-dismiss"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="ml-1 rounded px-1 opacity-70"
        style={{ color: 'inherit' }}
      >
        ✕
      </button>
    </div>
  );
}
