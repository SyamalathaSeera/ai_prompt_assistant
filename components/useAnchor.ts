import { useEffect, useState } from 'preact/hooks';

/**
 * Tracks an element's position so injected UI can be anchored to it.
 *
 * The badge is positioned *over* the page from inside our own fixed overlay
 * rather than inserted into the host DOM next to the composer. Injecting an
 * element into ChatGPT's layout would shift it — and a tool that visibly
 * rearranges the page it is protecting reads as breakage, not as help.
 *
 * The trade is that we have to follow the element ourselves as it moves, which
 * it does constantly: the composer grows as the draft gets longer, the page
 * scrolls, and the window resizes.
 */
export interface Anchor {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function readRect(element: Element | null): Anchor | null {
  if (!element || !element.isConnected) return null;
  const rect = element.getBoundingClientRect();
  // A zero-size rect means the element is hidden or detached mid-navigation.
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * How often a DOM mutation is allowed to trigger a re-measure.
 *
 * The observer below watches `document.body` with `subtree: true`, and the
 * host page is a chat that writes a streaming reply into the DOM token by
 * token. Unthrottled, that meant a `querySelector` and a
 * `getBoundingClientRect` — a forced synchronous layout — on every animation
 * frame for the entire length of a reply, and the page felt it.
 *
 * Half a second is safe because the mutation path is not what keeps the badge
 * in place. Scroll and resize are handled by their own listeners, and the
 * composer growing as the draft gets longer is handled by a `ResizeObserver`.
 * All this one has left to catch is the composer being *replaced*, which
 * happens on SPA navigation and is not something the user can outrun.
 */
const MUTATION_INTERVAL_MS = 500;

/**
 * Whether two measurements are close enough to skip a re-render.
 *
 * Sub-pixel jitter is common as the composer grows; re-rendering on a
 * hundredth of a pixel would be pure waste.
 */
function sameAnchor(a: Anchor | null, b: Anchor | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

/**
 * Returns the current viewport rect of whatever `resolve` finds, or null.
 *
 * `resolve` is called rather than an element being passed in, because the
 * composer is replaced wholesale on SPA navigation — holding a reference would
 * mean tracking a detached node forever.
 */
export function useAnchor(resolve: () => Element | null, deps: unknown[] = []): Anchor | null {
  const [anchor, setAnchor] = useState<Anchor | null>(() => readRect(resolve()));

  useEffect(() => {
    let frame: number | undefined;
    let disposed = false;

    /**
     * Coalesces measurements to one per frame.
     *
     * Falls back to a timeout where `requestAnimationFrame` is unavailable.
     * Scroll and mutation callbacks fire in bursts, and an unguarded measure
     * on each would thrash layout on the host page — the opposite of not
     * degrading its performance.
     */
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
    const cancelRaf =
      typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame
        : (id: number) => clearTimeout(id);

    const measure = () => {
      if (disposed) return;
      const next = readRect(resolve());
      // Compared against ACTUAL state via the functional form, not against a
      // closure variable. A cached "last measurement" desyncs whenever this
      // effect re-runs — it resets to empty while the state still holds the
      // old rect, after which a null measurement compares equal and is
      // skipped, stranding the badge over a composer that is no longer there.
      setAnchor((current) => (sameAnchor(current, next) ? current : next));
    };

    let dirty = false;

    const schedule = () => {
      // Observers can fire after teardown — removing our own container from
      // the page is itself a mutation, so unmounting triggers this.
      if (disposed) return;

      // Coalesce, but never DROP. Returning early here would discard the last
      // event of a resize burst, leaving the badge parked at a stale position
      // until something else happened to move it.
      if (frame !== undefined) {
        dirty = true;
        return;
      }

      frame = raf(() => {
        frame = undefined;
        measure();
        if (dirty) {
          dirty = false;
          schedule();
        }
      });
    };

    /*
     * Mutations are throttled far harder than scroll or resize.
     *
     * Trailing rather than leading-only: the last mutation of a burst is the
     * one that matters, and dropping it would strand the badge over a composer
     * that has just been replaced. At most one measure per interval either
     * way. See MUTATION_INTERVAL_MS for why this can afford to be slow.
     */
    let mutationTimer: ReturnType<typeof setTimeout> | undefined;
    let lastMutationRun = 0;

    const onMutation = () => {
      if (disposed || mutationTimer !== undefined) return;

      const wait = Math.max(0, MUTATION_INTERVAL_MS - (Date.now() - lastMutationRun));
      mutationTimer = setTimeout(() => {
        mutationTimer = undefined;
        lastMutationRun = Date.now();
        schedule();
      }, wait);
    };

    measure();

    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);

    // SPA navigation swaps the composer out entirely, which fires neither
    // resize nor scroll. Position changes are covered elsewhere, so this only
    // has to notice a replacement — hence the throttle.
    const observer = new MutationObserver(onMutation);
    observer.observe(document.body, { childList: true, subtree: true });

    let resizeObserver: ResizeObserver | undefined;
    const element = resolve();
    if (element && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(schedule);
      resizeObserver.observe(element);
    }

    return () => {
      disposed = true;
      if (frame !== undefined) cancelRaf(frame);
      if (mutationTimer !== undefined) clearTimeout(mutationTimer);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      observer.disconnect();
      resizeObserver?.disconnect();
    };
    // `deps` is caller-supplied on purpose: the hook re-measures when the
    // caller says something relevant changed, not on every render.
  }, deps);

  return anchor;
}
