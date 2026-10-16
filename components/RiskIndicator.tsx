import { useEffect, useMemo, useState } from 'preact/hooks';
import { detectAndRedact, redact } from '@/lib/detector/engine';
import { ALL_RULES } from '@/lib/detector/rules';
import { maskValue } from './mask';
import type { RiskStore } from './risk-store';
import { summarize } from './summarize';
import type { Anchor } from './useAnchor';

/**
 * The always-on risk indicator.
 *
 * This is what replaced the original "check my prompt" dropdown from the
 * product concept. A control the user has to remember to press is protection
 * that mostly does not happen; a badge that is simply always correct costs
 * them nothing.
 *
 * It is advisory only. It never blocks, never rewrites anything on its own,
 * and never submits — the submit-time gate does that work.
 */

const BADGE_HEIGHT = 26;
const GAP = 8;

interface Props {
  store: RiskStore;
  /**
   * The composer's current rect, measured once by `Panel` and shared.
   *
   * This used to run its own `useAnchor`, which meant a second
   * `MutationObserver` over `document.body` and a second forced layout per
   * frame — on a page that streams a reply into the DOM token by token. One
   * measurement serves both surfaces; they are anchored to the same element.
   */
  anchor: Anchor | null;
}

/**
 * Positions the badge above the composer's right edge.
 *
 * Above rather than inside: ChatGPT's send button, attachment button, and
 * dictation control all live along the bottom edge, and covering any of them
 * would make the extension the thing standing between the user and their work.
 */
function positionFor(anchor: Anchor): { top: number; left: number } {
  const top = Math.max(GAP, anchor.top - BADGE_HEIGHT - GAP);
  const left = Math.max(GAP, anchor.right - 160);
  return { top, left };
}

export function RiskIndicator({ store, anchor }: Props) {
  const [snapshot, setSnapshot] = useState(() => store.get());

  useEffect(() => {
    setSnapshot(store.get());
    return store.subscribe(setSnapshot);
  }, [store]);

  // Nothing to say, or nowhere to say it.
  if (snapshot.level === 'none' || !anchor) return null;

  const danger = snapshot.level === 'high';
  const { top, left } = positionFor(anchor);

  return (
    <div
      className="pointer-events-auto fixed"
      style={{ top: `${top}px`, left: `${left}px` }}
      data-testid="apa-risk-anchor"
    >
      <button
        type="button"
        data-testid="apa-risk-badge"
        data-level={snapshot.level}
        onClick={() => (snapshot.open ? store.close() : store.open())}
        aria-expanded={snapshot.open}
        aria-label={`${snapshot.findings.length} sensitive ${
          snapshot.findings.length === 1 ? 'item' : 'items'
        } detected in this prompt`}
        className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm"
        style={{
          background: danger ? 'var(--apa-danger-bg)' : 'var(--apa-warn-bg)',
          color: danger ? 'var(--apa-danger)' : 'var(--apa-warn)',
          borderColor: 'currentColor',
          height: `${BADGE_HEIGHT}px`,
        }}
      >
        <span
          aria-hidden="true"
          className="inline-block size-1.5 rounded-full"
          style={{ background: 'currentColor' }}
        />
        {snapshot.findings.length} {danger ? 'to redact' : 'to review'}
      </button>

      {snapshot.open && (
        <RiskPopover store={store} snapshot={snapshot} badgeTop={top} />
      )}
    </div>
  );
}

/** Smallest the popover may be squeezed to before it just scrolls instead. */
const MIN_POPOVER_HEIGHT = 180;

function RiskPopover({
  store,
  snapshot,
  badgeTop,
}: {
  store: RiskStore;
  snapshot: ReturnType<RiskStore['get']>;
  /** Viewport offset of the badge, so the panel can work out where it fits. */
  badgeTop: number;
}) {
  // Computed here rather than stored, so it always reflects the current draft.
  const redacted = useMemo(
    () => redact(snapshot.text, snapshot.findings).text,
    [snapshot.text, snapshot.findings],
  );

  /*
   * Everything the full rule set can find.
   *
   * Deliberately ignores both the disabled-rule settings and the allowlist,
   * which is the entire difference between this and the button beside it. The
   * findings above are what the live scan produced under the user's own
   * settings; this is what the detector could produce if asked to stop being
   * polite — the families they switched off because those are noisy day to
   * day, and the values they allowlisted for the same reason.
   *
   * Overriding an allowlist entry is normally the wrong thing to do, and it is
   * only acceptable here because it takes an explicit press. Nothing about
   * this path runs on its own.
   */
  const everything = useMemo(
    () => detectAndRedact(snapshot.text, {}, ALL_RULES).text,
    [snapshot.text],
  );

  /*
   * Only offered when it would actually do something different. Two buttons
   * that produce identical text is a decision the user has to stop and make
   * for no reason.
   */
  const findsMore = everything !== redacted;

  /*
   * Which way to open, and how tall it may be.
   *
   * The badge sits just above the composer, and the composer sits at the
   * bottom of the window — so opening downward ran the panel off the screen
   * and there was no way to reach the buttons at all. Whichever side has more
   * room wins, and the panel is then capped to that room and scrolls inside
   * itself. The cap matters on its own: a draft with a dozen findings would
   * overflow even upward on a short window.
   */
  const viewport = typeof window === 'undefined' ? 0 : window.innerHeight;
  const spaceAbove = badgeTop - GAP;
  const spaceBelow = viewport - badgeTop - BADGE_HEIGHT - GAP * 2;
  const openUp = spaceAbove > spaceBelow;
  const maxHeight = Math.max(MIN_POPOVER_HEIGHT, openUp ? spaceAbove : spaceBelow);

  return (
    <div
      role="dialog"
      aria-label="Sensitive data in this prompt"
      data-testid="apa-risk-popover"
      data-direction={openUp ? 'up' : 'down'}
      className="absolute right-0 w-80 overflow-y-auto rounded-lg border p-3 text-sm shadow-xl"
      style={{
        background: 'var(--apa-bg)',
        color: 'var(--apa-fg)',
        borderColor: 'var(--apa-border)',
        boxShadow: 'var(--apa-shadow)',
        maxHeight: `${maxHeight}px`,
        ...(openUp
          ? { bottom: `${BADGE_HEIGHT + GAP}px` }
          : { top: `${BADGE_HEIGHT + GAP}px` }),
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        store.close();
      }}
    >
      <p className="font-medium">{summarize(snapshot.findings)}</p>
      <p className="mt-1 text-xs" style={{ color: 'var(--apa-muted)' }}>
        Nothing has been sent. These will be redacted automatically when you
        submit.
      </p>

      {snapshot.error && <p role="alert" className="mt-2 text-xs">{snapshot.error}</p>}
      <ul className="mt-2 space-y-1" data-testid="apa-risk-items">
        {[...new Map(snapshot.findings.map((f) => [f.placeholder, f])).values()].map(
          (finding) => (
            <li
              key={finding.placeholder}
              className="flex items-center justify-between gap-2 rounded px-2 py-1 font-mono text-xs"
              style={{ background: 'var(--apa-surface)' }}
            >
              <span className="truncate">{finding.label}</span>
              <span className="shrink-0 opacity-70" data-testid="apa-risk-masked">
                {maskValue(snapshot.text.slice(finding.start, finding.end))}
              </span>
            </li>
          ),
        )}
      </ul>

      {findsMore && (
        <p
          className="mt-3 text-xs"
          data-testid="apa-risk-more-note"
          style={{ color: 'var(--apa-muted)' }}
        >
          There is more here that your settings do not normally flag — personal
          details, or families you have switched off.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="apa-risk-apply"
          disabled={snapshot.applying}
          onClick={() => store.applyRedaction(redacted)}
          className="rounded-md px-2.5 py-1.5 text-xs font-medium"
          style={{ background: 'var(--apa-accent)', color: 'var(--apa-accent-fg)' }}
        >
          Redact now
        </button>

        {findsMore && (
          <button
            type="button"
            data-testid="apa-risk-apply-all"
            disabled={snapshot.applying}
            onClick={() => store.applyRedaction(everything)}
            title="Applies every rule, including ones you have turned off and values you have allowlisted"
            className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
            style={{ borderColor: 'var(--apa-border)', color: 'var(--apa-fg)' }}
          >
            Redact everything
          </button>
        )}

        <button
          type="button"
          data-testid="apa-risk-close"
          onClick={() => store.close()}
          className="rounded-md px-2.5 py-1.5 text-xs"
          style={{ color: 'var(--apa-muted)' }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
