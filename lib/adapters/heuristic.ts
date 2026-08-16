import { hasLayout, isUsable } from './resolve';
import type { SelectorStrategy } from './resolve';

/**
 * Last-resort composer discovery.
 *
 * Every strategy above these in a chain names something specific about a host
 * page — an id, a role, a class. That is what makes them precise, and it is
 * also what makes them break: they encode assumptions the host page never
 * agreed to keep.
 *
 * These two encode something the host page cannot change without changing what
 * the product *is*: a chat interface has a box you type into, and a control
 * that sends it. A redesign that breaks every selector in this repository
 * still has to have those, or it is not a chat interface any more.
 *
 * They are deliberately last. A heuristic that fires while a named selector
 * would have worked is a silent downgrade in precision — so the chain reports
 * which strategy resolved, and `lib/health/` treats reaching this point as
 * degraded rather than healthy. Working is not the same as working properly,
 * and the user is told the difference.
 *
 * **With milestone 0.5.0.0 Task 2 deferred, this is the whole recovery story.**
 * There is no remote selector feed coming to fix a DOM change; either these
 * find the composer or the user waits for a store update. That is the trade
 * that was accepted, and it is why these are worth getting right.
 */

/**
 * Editable things a person types a prompt into.
 *
 * `[contenteditable]:not([contenteditable="false"])` rather than
 * `[contenteditable="true"]`, which is what this originally said. The attribute
 * has other truthy values — `plaintext-only` is real, supported, and exactly
 * what a chat composer would sensibly use — and an empty value (`contenteditable`
 * on its own) also means true.
 *
 * The narrow version passed its unit test because that fixture kept
 * `role="textbox"` as a second way in. The end-to-end suite removed the role as
 * well, which is the harsher and more honest break, and the heuristics found
 * nothing at all. A recovery path that only recovers from the failures you
 * thought of is not a recovery path.
 */
const EDITABLE =
  'textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

/**
 * Controls that look like they send.
 *
 * Type and semantics only — no label text. Label matching would work on an
 * English page and fail on every other one, which is the kind of bug that
 * only shows up in the countries nobody tested in.
 */
const SUBMIT_CONTROL =
  'button[type="submit"], input[type="submit"], form button:not([type="button"])';

/** Whether an element can actually be typed into. */
function isEditable(element: Element): boolean {
  if (!isUsable(element)) return false;
  if (element.getAttribute('aria-disabled') === 'true') return false;
  if ((element as HTMLTextAreaElement).disabled === true) return false;
  if ((element as HTMLTextAreaElement).readOnly === true) return false;
  return true;
}

/**
 * The editable the user is currently typing in.
 *
 * The strongest signal available, and the cheapest: focus is the page telling
 * us where the person's attention is, and no amount of DOM churn changes what
 * it means.
 *
 * Deliberately does NOT require layout. An element with focus is by definition
 * the one being used, and jsdom reports every element as 0×0 — requiring a
 * rect here would make the strategy untestable and reject nothing real.
 */
export function byFocusedEditable<T extends Element = HTMLElement>(
  name = 'focused-editable',
): SelectorStrategy<T> {
  return {
    name,
    find: (root) => {
      const owner =
        (root as Document).activeElement !== undefined
          ? (root as Document)
          : (root as Element).ownerDocument;

      const active = owner?.activeElement as T | null;
      if (!active || !active.matches?.(EDITABLE)) return null;
      if (!isEditable(active)) return null;

      // A focused editable inside our own shadow UI is not the host page's
      // composer — writing the user's prompt into our own textarea would be a
      // spectacular way to lose it.
      if (active.closest('[data-testid^="apa-"]')) return null;

      return active;
    },
  };
}

/**
 * The editable nearest a control that submits.
 *
 * "Nearest" is measured by DOM distance rather than pixels, because pixel
 * proximity is a property of the stylesheet and DOM structure is a property of
 * the markup — the markup is the more stable of the two, and it survives a
 * layout change that moves the send button somewhere else entirely.
 *
 * Falls back to document order when nothing has layout, so this still resolves
 * under jsdom and in a page that has not painted yet.
 */
export function byEditableNearSubmit<T extends Element = HTMLElement>(
  name = 'editable-near-submit',
): SelectorStrategy<T> {
  return {
    name,
    find: (root) => {
      const editables = [...root.querySelectorAll<T>(EDITABLE)].filter(isEditable);
      if (editables.length === 0) return null;

      const controls = [...root.querySelectorAll<HTMLElement>(SUBMIT_CONTROL)].filter(
        isUsable,
      );

      // No send control anywhere: fall back to the largest editable, which on
      // any real page is the composer rather than a search box.
      if (controls.length === 0) return preferLargest(editables);

      let best: T | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const editable of editables) {
        for (const control of controls) {
          const distance = domDistance(editable, control);
          if (distance === null) continue;

          // Ties go to the larger element. Two editables equidistant from the
          // send button is exactly the ChatGPT case — a real composer and a
          // 0×0 decoy textarea, siblings in the same form.
          if (
            distance < bestDistance ||
            (distance === bestDistance && best !== null && area(editable) > area(best))
          ) {
            best = editable;
            bestDistance = distance;
          }
        }
      }

      return best;
    },
  };
}

function area(element: Element): number {
  const rect = element.getBoundingClientRect();
  return rect.width * rect.height;
}

/** Largest by rendered area, falling back to the first in document order. */
function preferLargest<T extends Element>(elements: readonly T[]): T | null {
  const visible = elements.filter(hasLayout);
  const pool = visible.length > 0 ? visible : elements;
  if (pool.length === 0) return null;

  return pool.reduce((best, candidate) =>
    area(candidate) > area(best) ? candidate : best,
  );
}

/**
 * Steps between two nodes through their nearest common ancestor.
 *
 * Null when they share no ancestor, which means one of them is detached and
 * the pairing is meaningless.
 */
function domDistance(a: Element, b: Element): number | null {
  const ancestors = new Map<Element, number>();

  let depth = 0;
  for (let node: Element | null = a; node; node = node.parentElement) {
    ancestors.set(node, depth);
    depth += 1;
  }

  let climbed = 0;
  for (let node: Element | null = b; node; node = node.parentElement) {
    const fromA = ancestors.get(node);
    if (fromA !== undefined) return fromA + climbed;
    climbed += 1;
  }

  return null;
}

/**
 * The shared tail of every adapter's composer chain.
 *
 * Exported as one array so a platform cannot accidentally ship without a
 * recovery path — adding a site adapter means appending this, and the
 * conformance suite checks that it is there.
 */
export const HEURISTIC_COMPOSER_STRATEGIES: readonly SelectorStrategy[] = [
  byFocusedEditable(),
  byEditableNearSubmit(),
];

/**
 * Strategy names that mean "we guessed".
 *
 * Wider than the two heuristics above, and the difference matters. Each adapter
 * ends its chain with `largest-editable` and `visible-textarea`, which name a
 * *shape* rather than anything about the platform — they are fallbacks in
 * everything but where they sit in the file.
 *
 * The health layer originally graded only the two heuristics as degraded, so a
 * resolution through one of these reported **healthy**. That was observed live
 * on chatgpt.com: one second after injection the ProseMirror composer had not
 * rendered, the chain fell through to `visible-textarea`, health reported
 * `healthy` — and because a healthy page stops being polled, it never looked
 * again. The extension sat on a guess and called it fine.
 *
 * Grading them as degraded fixes both halves at once: the user is told the
 * ground has moved, and the monitor keeps checking, so it upgrades itself to
 * healthy the moment the real composer appears.
 */
export const FALLBACK_STRATEGY_NAMES: readonly string[] = [
  ...HEURISTIC_COMPOSER_STRATEGIES.map((s) => s.name),
  'largest-editable',
  'visible-textarea',
];
