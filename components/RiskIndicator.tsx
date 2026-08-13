import { useEffect, useState } from 'preact/hooks';
import { redact } from '@/lib/detector/engine';
import { maskValue } from './mask';
import type { RiskStore } from './risk-store';
import { summarize } from './summarize';
import { useAnchor, type Anchor } from './useAnchor';

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
  /** Resolves the composer. Called fresh each measure, since SPA nav swaps it. */
  getComposer: () => Element | null;
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

export function RiskIndicator({ store, getComposer }: Props) {
  const [snapshot, setSnapshot] = useState(() => store.get());

  useEffect(() => {
    setSnapshot(store.get());
    return store.subscribe(setSnapshot);
  }, [store]);

  const anchor = useAnchor(getComposer, [snapshot.level]);

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

      {snapshot.open && <RiskPopover store={store} snapshot={snapshot} />}
    </div>
  );
}

function RiskPopover({
  store,
  snapshot,
}: {
  store: RiskStore;
  snapshot: ReturnType<RiskStore['get']>;
}) {
  // Computed here rather than stored, so it always reflects the current draft.
  const redacted = redact(snapshot.text, snapshot.findings).text;

  return (
    <div
      role="dialog"
      aria-label="Sensitive data in this prompt"
      data-testid="apa-risk-popover"
      className="absolute right-0 mt-2 w-80 rounded-lg border p-3 text-sm shadow-xl"
      style={{
        background: 'var(--apa-bg)',
        color: 'var(--apa-fg)',
        borderColor: 'var(--apa-border)',
        boxShadow: 'var(--apa-shadow)',
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

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-testid="apa-risk-apply"
          onClick={() => store.applyRedaction(redacted)}
          className="rounded-md px-2.5 py-1.5 text-xs font-medium"
          style={{ background: 'var(--apa-accent)', color: 'var(--apa-accent-fg)' }}
        >
          Redact now
        </button>
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
