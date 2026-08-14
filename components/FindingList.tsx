import { useState } from 'preact/hooks';
import { maskValue } from './mask';
import { toRows, type PanelState, type PanelStore } from './panel-store';

/**
 * The per-finding list.
 *
 * This is the "diff": each row shows `AKIA…TIC7 → [REDACTED_AWS_1]`, which is
 * exactly what will change, at the granularity the user actually decides at.
 *
 * A conventional before/after text diff was rejected — it would put every
 * secret back on screen at full length, in a panel that may be over a shared
 * screen or a recorded call. Showing the change without showing the value is
 * the whole point.
 */

interface Props {
  state: Extract<PanelState, { kind: 'active' }>;
  store: PanelStore;
}

/**
 * Most rows to render.
 *
 * The remaining freeze risk after redaction was made linear. Someone who pastes
 * a leaked credentials dump — the exact person this product is for — can
 * produce thousands of distinct findings, and a row each would build thousands
 * of DOM nodes inside a synchronous render.
 *
 * Capping the *display* costs nothing real: every finding is still detected and
 * still redacted, and the toggles exist for the case where a user disagrees
 * about one or two values. Nobody audits five thousand checkboxes. The count is
 * shown so the cap is visible rather than silent — a list that quietly stopped
 * at 200 would misrepresent what is about to be sent.
 */
const MAX_ROWS = 200;

export function FindingList({ state, store }: Props) {
  const rows = toRows(state.submission, state.selection, maskValue);
  const blocking = rows.filter((row) => row.tier === 'high');
  const advisory = rows.filter((row) => row.tier === 'low');
  const busy = state.phase === 'applying';

  const shownBlocking = blocking.slice(0, MAX_ROWS);
  const hiddenBlocking = blocking.length - shownBlocking.length;

  // Advisory items start collapsed. They are suggestions, and letting a list
  // of email addresses push the actual credentials off screen would invert
  // the priority the tier system exists to express.
  const [showAdvisory, setShowAdvisory] = useState(false);

  return (
    <div className="mt-3" data-testid="apa-finding-list">
      <ul className="space-y-1">
        {shownBlocking.map((row) => (
          <Row key={row.placeholder} row={row} store={store} busy={busy} />
        ))}
      </ul>

      {hiddenBlocking > 0 && (
        <p
          data-testid="apa-rows-capped"
          className="mt-2 text-xs"
          style={{ color: 'var(--apa-muted)' }}
        >
          …and {hiddenBlocking} more. All of them will be replaced — only the list
          is shortened.
        </p>
      )}

      {advisory.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            data-testid="apa-advisory-toggle"
            onClick={() => setShowAdvisory((open) => !open)}
            className="text-xs underline-offset-2 hover:underline"
            style={{ color: 'var(--apa-muted)' }}
            aria-expanded={showAdvisory}
          >
            {showAdvisory ? 'Hide' : 'Show'} {advisory.length} advisory{' '}
            {advisory.length === 1 ? 'item' : 'items'}
          </button>

          {showAdvisory && (
            <ul className="mt-1 space-y-1" data-testid="apa-advisory-list">
              {advisory.map((row) => (
                <Row key={row.placeholder} row={row} store={store} busy={busy} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  row,
  store,
  busy,
}: {
  row: ReturnType<typeof toRows>[number];
  store: PanelStore;
  busy: boolean;
}) {
  const danger = row.tier === 'high';

  return (
    <li
      data-testid="apa-finding-row"
      data-placeholder={row.placeholder}
      data-selected={row.selected}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
      style={{
        background: danger ? 'var(--apa-danger-bg)' : 'var(--apa-warn-bg)',
        color: danger ? 'var(--apa-danger)' : 'var(--apa-warn)',
        opacity: row.selected ? 1 : 0.55,
      }}
    >
      <input
        type="checkbox"
        data-testid="apa-finding-toggle"
        checked={row.selected}
        disabled={busy}
        onChange={() => store.toggle(row.placeholder)}
        aria-label={`Redact ${row.label}`}
        className="shrink-0"
      />

      <div className="min-w-0 grow">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{row.label}</span>
          {row.occurrences > 1 && (
            <span className="text-xs opacity-70">×{row.occurrences}</span>
          )}
        </div>
        <div className="mt-0.5 truncate font-mono text-xs opacity-80">
          <span data-testid="apa-finding-masked">{row.masked}</span>
          <span aria-hidden="true"> → </span>
          <span className="sr-only">becomes</span>
          <span data-testid="apa-finding-placeholder">
            {row.selected ? row.placeholder : 'unchanged'}
          </span>
        </div>
      </div>

      <button
        type="button"
        data-testid="apa-finding-allowlist"
        disabled={busy}
        onClick={() => store.allowlist(row.placeholder)}
        title="Never flag this value again"
        className="shrink-0 text-xs underline-offset-2 hover:underline disabled:opacity-50"
        style={{ color: 'var(--apa-muted)' }}
      >
        Never flag
      </button>
    </li>
  );
}
