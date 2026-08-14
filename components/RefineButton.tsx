import { useEffect, useState } from 'preact/hooks';
import { STYLES, type RefinementStyle } from '@/lib/refine';
import type { RefineStore } from './refine-store';
import type { Anchor } from './useAnchor';

/**
 * The refinement trigger.
 *
 * Explicit invocation only — a button and a keyboard shortcut. Refinement is
 * never automatic: rewriting what someone typed without being asked is
 * presumptuous, and unlike redaction there is no safety argument for it.
 *
 * Positioned above the composer's LEFT edge, so it cannot collide with the
 * risk badge on the right. The two can be on screen simultaneously and must
 * never overlap.
 */

const BUTTON_HEIGHT = 26;
const GAP = 8;

interface Props {
  store: RefineStore;
  anchor: Anchor;
  /** Hidden entirely when the model cannot run here. */
  available: boolean;
}

export function RefineButton({ store, anchor, available }: Props) {
  const [state, setState] = useState(() => store.get());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    setState(store.get());
    return store.subscribe(setState);
  }, [store]);

  if (!available) return null;

  const working = state.phase === 'working';
  const top = Math.max(GAP, anchor.top - BUTTON_HEIGHT - GAP);
  const left = Math.max(GAP, anchor.left);

  return (
    <div
      className="pointer-events-auto fixed"
      style={{ top: `${top}px`, left: `${left}px` }}
      data-testid="apa-refine-anchor"
    >
      <div className="flex items-center gap-1">
        {/*
          While working, this cancels rather than being disabled.

          On-device inference measured 3–11 seconds. A disabled button for that
          long leaves the user watching a control that ignores them, with no way
          out but reloading the page — so the button becomes the way to stop.
        */}
        <button
          type="button"
          data-testid="apa-refine-button"
          onClick={() => (working ? store.cancel() : void store.start())}
          aria-label={working ? 'Stop improving this prompt' : 'Improve this prompt'}
          className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm disabled:opacity-60"
          style={{
            background: 'var(--apa-surface)',
            color: 'var(--apa-fg)',
            borderColor: 'var(--apa-border)',
            height: `${BUTTON_HEIGHT}px`,
          }}
        >
          {working ? 'Improving… ✕' : 'Improve'}
        </button>

        <button
          type="button"
          data-testid="apa-refine-style"
          disabled={working}
          onClick={() => setPickerOpen((open) => !open)}
          aria-expanded={pickerOpen}
          aria-label="Choose how to improve it"
          className="rounded-full border px-2 py-1 text-xs shadow-sm disabled:opacity-60"
          style={{
            background: 'var(--apa-surface)',
            color: 'var(--apa-muted)',
            borderColor: 'var(--apa-border)',
            height: `${BUTTON_HEIGHT}px`,
          }}
        >
          ⌄
        </button>
      </div>

      {pickerOpen && !working && (
        <div
          role="menu"
          data-testid="apa-refine-styles"
          className="absolute left-0 mt-2 w-64 rounded-lg border p-1 shadow-xl"
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
            setPickerOpen(false);
          }}
        >
          {STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              role="menuitem"
              data-testid={`apa-refine-style-${style.id}`}
              onClick={() => {
                setPickerOpen(false);
                store.setStyle(style.id as RefinementStyle);
                void store.start(style.id as RefinementStyle);
              }}
              className="block w-full rounded-md px-2.5 py-2 text-left text-xs hover:bg-current/5"
              style={{
                background:
                  style.id === state.style ? 'var(--apa-surface)' : 'transparent',
              }}
            >
              <span className="block font-medium">{style.label}</span>
              <span className="mt-0.5 block opacity-60">{style.description}</span>
            </button>
          ))}
        </div>
      )}

      {/*
        Failures are shown here rather than in a dialog. A refinement that did
        not work is not worth interrupting someone over — their draft is
        untouched and they can carry on.
      */}
      {state.phase === 'failed' && (
        <p
          role="status"
          data-testid="apa-refine-message"
          className="mt-2 max-w-xs rounded-md border px-2.5 py-1.5 text-xs shadow-sm"
          style={{
            background: 'var(--apa-bg)',
            color: 'var(--apa-muted)',
            borderColor: 'var(--apa-border)',
          }}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
