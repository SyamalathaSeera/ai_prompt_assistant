/**
 * Fallback selector resolution.
 *
 * Host pages ship DOM changes constantly, and a single hardcoded selector is a
 * time bomb: when it breaks, the extension silently stops protecting the user
 * while continuing to look installed and healthy. That silent failure is worse
 * than an obvious one.
 *
 * So every element lookup is a *chain* of independent strategies, tried in
 * order of durability — semantic signals first (role, aria, element type),
 * generated class names last if at all. The chain reports which strategy
 * succeeded, which turns "ChatGPT changed something" into a specific,
 * diagnosable fact instead of a mystery.
 */

export interface SelectorStrategy<T extends Element = HTMLElement> {
  /**
   * Stable identifier for diagnostics, e.g. `aria-label` or
   * `contenteditable-near-send`. Surfaced in the health check and in bug
   * reports, so it must describe the technique, not the selector string.
   */
  name: string;
  find: (root: ParentNode) => T | null;
}

export interface Resolution<T extends Element> {
  element: T | null;
  /** Name of the strategy that succeeded, or null if none did. */
  resolvedVia: string | null;
  /** Every strategy tried, in order. Empty once one succeeds early. */
  attempted: string[];
}

/**
 * Runs strategies in order and returns the first element found.
 *
 * Each strategy is isolated: a selector that throws (an invalid query, a
 * detached node, a same-origin frame that has gone away) is treated as "not
 * found" and the chain continues. One broken strategy must never take down the
 * ones after it.
 */
export function resolveWithFallback<T extends Element>(
  root: ParentNode,
  strategies: readonly SelectorStrategy<T>[],
): Resolution<T> {
  const attempted: string[] = [];

  for (const strategy of strategies) {
    attempted.push(strategy.name);

    let found: T | null = null;
    try {
      found = strategy.find(root);
    } catch {
      // Treated as "not found" — see above.
      continue;
    }

    if (found && isUsable(found)) {
      return { element: found, resolvedVia: strategy.name, attempted };
    }
  }

  return { element: null, resolvedVia: null, attempted };
}

/**
 * Whether an element is actually present and interactive.
 *
 * A query can succeed against a node that is detached, hidden, or a leftover
 * from a previous route. Writing into one of those would silently do nothing —
 * the user would see their prompt unchanged and conclude the extension is
 * broken, which it would be.
 */
export function isUsable(element: Element): boolean {
  if (!element.isConnected) return false;
  if (element.hasAttribute('hidden')) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;
  return true;
}

/**
 * Whether an element occupies space on screen.
 *
 * Separate from `isUsable` because it cannot be relied on in jsdom, where
 * every element measures 0×0 — folding it into `isUsable` would make the whole
 * fallback chain untestable.
 *
 * Live inspection of chatgpt.com found this matters concretely: the page ships
 * a 0×0 `<textarea name="prompt-textarea">` alongside the real ProseMirror
 * composer. It is connected, not `hidden`, and not `aria-hidden`, so every
 * other check passes — but writing into it would do nothing the user can see.
 */
export function hasLayout(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Builds a strategy from a CSS selector, requiring the match to occupy space. */
export function byVisibleSelector<T extends Element = HTMLElement>(
  name: string,
  selector: string,
): SelectorStrategy<T> {
  return {
    name,
    find: (root) => [...root.querySelectorAll<T>(selector)].find(hasLayout) ?? null,
  };
}

/** Builds a strategy from a plain CSS selector. */
export function bySelector<T extends Element = HTMLElement>(
  name: string,
  selector: string,
): SelectorStrategy<T> {
  return {
    name,
    find: (root) => root.querySelector<T>(selector),
  };
}

/**
 * Builds a strategy that picks the largest match by rendered area.
 *
 * Useful when several candidates match — a page may hold an offscreen or
 * collapsed duplicate of the composer, and the one the user is actually typing
 * into is invariably the biggest.
 */
export function byLargest<T extends Element = HTMLElement>(
  name: string,
  selector: string,
): SelectorStrategy<T> {
  return {
    name,
    find: (root) => {
      const candidates = [...root.querySelectorAll<T>(selector)].filter(isUsable);
      if (candidates.length === 0) return null;

      return candidates.reduce((best, candidate) => {
        const area = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.width * r.height;
        };
        return area(candidate) > area(best) ? candidate : best;
      });
    },
  };
}
