import { useEffect, useRef, useState } from 'preact/hooks';
import { warmSession } from '@/lib/model';
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
 *
 * Presented as one segmented pill rather than two adjacent buttons. This sits
 * on top of a polished chat interface, and two floating capsules with a gap
 * between them read as debris the page did not intend. Its colours and states
 * live in `entrypoints/content/style.css` rather than inline, because inline
 * styles outrank classes and would have made every hover and focus rule dead
 * on arrival.
 */

const BUTTON_HEIGHT = 26;
const GAP = 8;

/** Matches `wxt.config.ts`. Shown so the shortcut is discoverable from the UI. */
const SHORTCUT = 'Alt+Shift+I';

/**
 * Rough height of the open style menu, used only to choose a direction.
 *
 * An exact measurement would need a layout pass the menu has not had yet, and
 * being a few pixels out only picks the same side a moment earlier. Each row
 * is a label over a description at 12px, plus the list's own padding.
 */
const MENU_HEIGHT = STYLES.length * 46 + 8;

/** Smallest the menu may be squeezed to before it just scrolls instead. */
const MIN_MENU_HEIGHT = 120;

interface Props {
  store: RefineStore;
  anchor: Anchor;
  /** Hidden entirely when the model cannot run here. */
  available: boolean;
}

/** Decorative throughout: every icon here sits beside a real text label. */
function SparkleIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M6.6 1.6a.4.4 0 0 1 .76 0l.86 2.36 2.36.86a.4.4 0 0 1 0 .76l-2.36.86-.86 2.36a.4.4 0 0 1-.76 0l-.86-2.36-2.36-.86a.4.4 0 0 1 0-.76l2.36-.86z"
      />
      <path
        fill="currentColor"
        opacity="0.75"
        d="M11.9 9.1a.3.3 0 0 1 .57 0l.5 1.36 1.37.5a.3.3 0 0 1 0 .57l-1.37.5-.5 1.37a.3.3 0 0 1-.57 0l-.5-1.37-1.36-.5a.3.3 0 0 1 0-.57l1.36-.5z"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
      focusable="false"
      className="apa-spin"
    >
      {/* The faint full ring keeps the moving arc from reading as a stray mark. */}
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.25"
      />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
      <path
        d="M4.5 4.5l7 7M11.5 4.5l-7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
      style={{ transform: up ? 'rotate(180deg)' : undefined }}
    >
      <path
        d="M4 6.5L8 10.5L12 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
      style={{ color: 'var(--apa-accent)', flexShrink: 0, marginTop: '2px' }}
    >
      <path
        d="M3.5 8.5l3 3 6-6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RefineButton({ store, anchor, available }: Props) {
  const [state, setState] = useState(() => store.get());
  const [pickerOpen, setPickerOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    setState(store.get());
    return store.subscribe(setState);
  }, [store]);

  const working = state.phase === 'working';

  /*
   * Close the menu on a click anywhere else.
   *
   * A menu dismissible only by Escape or by hitting the caret again is a trap
   * on a page whose own UI is one click away.
   *
   * `composedPath()` rather than `contains()`: the event starts inside a
   * shadow root, and by the time it reaches the document its target has been
   * retargeted to the shadow host — which would make every click, including
   * clicks on the menu itself, look external.
   */
  useEffect(() => {
    if (!pickerOpen) return;

    const onPointerDown = (event: Event) => {
      const node = root.current;
      if (node && !event.composedPath().includes(node)) setPickerOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [pickerOpen]);

  /* Open with the current choice focused, so the menu starts where the user is. */
  useEffect(() => {
    if (!pickerOpen) return;
    const current = STYLES.findIndex((style) => style.id === state.style);
    items.current[current < 0 ? 0 : current]?.focus();
  }, [pickerOpen, state.style]);

  if (!available) return null;

  const top = Math.max(GAP, anchor.top - BUTTON_HEIGHT - GAP);
  const left = Math.max(GAP, anchor.left);

  /*
   * Open upward when there is room.
   *
   * The control sits directly above the composer, so a downward menu covers
   * the draft the user is picking a style for. Upward is the better default,
   * with downward as the fallback rather than the other way round.
   */
  const openUp = top > MENU_HEIGHT + GAP;

  /*
   * Cap the menu to the room it actually has and let it scroll inside itself.
   *
   * Choosing a side is not enough on a short window, or with the browser
   * zoomed: the last option ended up under the edge of the screen with no way
   * to reach it. The direction above picks the better side; this makes sure
   * everything on that side stays reachable either way.
   */
  const viewport = typeof window === 'undefined' ? 0 : window.innerHeight;
  const room = openUp ? top - GAP : viewport - top - BUTTON_HEIGHT - GAP * 2;
  const menuMaxHeight = Math.max(MIN_MENU_HEIGHT, room);

  const closePicker = () => {
    setPickerOpen(false);
    caret.current?.focus();
  };

  /** Arrow-key navigation, which `role="menu"` promises and buttons do not give. */
  const onMenuKeyDown = (event: KeyboardEvent) => {
    const focused = items.current.findIndex((item) => item === document.activeElement);
    const last = STYLES.length - 1;
    let next: number | null = null;

    if (event.key === 'ArrowDown') next = focused >= last ? 0 : focused + 1;
    else if (event.key === 'ArrowUp') next = focused <= 0 ? last : focused - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'Escape' || event.key === 'Tab') {
      // The host page listens for Escape too, so it stops here.
      event.preventDefault();
      event.stopPropagation();
      closePicker();
      return;
    } else return;

    event.preventDefault();
    event.stopPropagation();
    items.current[next]?.focus();
  };

  const choose = (style: RefinementStyle) => {
    setPickerOpen(false);
    store.setStyle(style);
    void store.start(style);
  };

  const currentStyle = STYLES.find((style) => style.id === state.style);

  return (
    <div
      ref={root}
      className="pointer-events-auto fixed"
      style={{ top: `${top}px`, left: `${left}px` }}
      data-testid="apa-refine-anchor"
    >
      <div className="apa-improve-group" style={{ height: `${BUTTON_HEIGHT}px` }}>
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
          /*
           * Build the session while the pointer is on its way to the click.
           *
           * Roughly three seconds of every refinement is spent before the
           * first word appears, and part of that is constructing the session.
           * Hovering is as clear a statement of intent as this UI gets, and
           * `warmSession` refuses to do anything that would cost the user
           * bandwidth, so a hover that never becomes a click costs nothing.
           */
          onPointerEnter={() => void warmSession()}
          onFocus={() => void warmSession()}
          aria-label={working ? 'Stop improving this prompt' : 'Improve this prompt'}
          aria-keyshortcuts={working ? undefined : SHORTCUT}
          title={
            working
              ? 'Stop improving this prompt'
              : `Improve this prompt (${SHORTCUT}) — ${currentStyle?.label ?? ''}`
          }
          className="apa-improve-action"
        >
          {working ? <SpinnerIcon /> : <SparkleIcon />}
          {working ? 'Improving…' : 'Improve'}
          {working && <StopIcon />}
        </button>

        <button
          ref={caret}
          type="button"
          data-testid="apa-refine-style"
          disabled={working}
          onClick={() => setPickerOpen((open) => !open)}
          aria-expanded={pickerOpen}
          aria-haspopup="true"
          aria-label={`Choose how to improve it, currently ${currentStyle?.label ?? ''}`}
          title="Choose how to improve it"
          className="apa-improve-caret"
        >
          <ChevronIcon up={pickerOpen ? !openUp : openUp} />
        </button>
      </div>

      {pickerOpen && !working && (
        <div
          role="menu"
          aria-label="How to improve this prompt"
          data-testid="apa-refine-styles"
          data-direction={openUp ? 'up' : 'down'}
          className="apa-improve-menu absolute left-0 w-64 overflow-y-auto p-1"
          style={{
            maxHeight: `${menuMaxHeight}px`,
            ...(openUp
              ? { bottom: `${BUTTON_HEIGHT + GAP}px` }
              : { top: `${BUTTON_HEIGHT + GAP}px` }),
          }}
          onKeyDown={onMenuKeyDown}
        >
          {STYLES.map((style, index) => {
            const chosen = style.id === state.style;

            return (
              <button
                key={style.id}
                ref={(element) => {
                  items.current[index] = element as HTMLButtonElement | null;
                }}
                type="button"
                /*
                 * menuitemradio, not menuitem: these are five names for one
                 * setting, and a screen reader that says which one is current
                 * saves opening the menu to find out.
                 */
                role="menuitemradio"
                aria-checked={chosen}
                data-testid={`apa-refine-style-${style.id}`}
                onClick={() => choose(style.id as RefinementStyle)}
                className="apa-improve-item"
              >
                {chosen ? (
                  <CheckIcon />
                ) : (
                  <span aria-hidden="true" style={{ width: '12px', flexShrink: 0 }} />
                )}
                <span>
                  <span className="block font-medium">{style.label}</span>
                  <span className="mt-0.5 block" style={{ color: 'var(--apa-muted)' }}>
                    {style.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/*
        Failures are shown here rather than in a dialog. A refinement that did
        not work is not worth interrupting someone over — their draft is
        untouched and they can carry on.
      */}
      {state.phase === 'failed' && (
        /*
         * Placed the same way the menu is, and for the same reason.
         *
         * As a plain sibling with a top margin this landed at exactly
         * `composer.top` — the container sits 34px above the composer, the
         * pill takes 26 of them and the margin the other 8 — so the note
         * covered the first line of the draft it was reporting on. Pinned to
         * whichever side has room instead.
         */
        <p
          role="status"
          data-testid="apa-refine-message"
          data-direction={openUp ? 'up' : 'down'}
          className="absolute left-0 w-64 rounded-md border px-2.5 py-1.5 text-xs shadow-sm"
          style={{
            background: 'var(--apa-bg)',
            color: 'var(--apa-muted)',
            borderColor: 'var(--apa-border)',
            ...(openUp
              ? { bottom: `${BUTTON_HEIGHT + GAP}px` }
              : { top: `${BUTTON_HEIGHT + GAP}px` }),
          }}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
