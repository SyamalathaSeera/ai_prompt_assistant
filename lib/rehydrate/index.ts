import { placeholderPattern } from '../detector/engine';

/**
 * Response re-hydration.
 *
 * When the model echoes `[REDACTED_AWS_KEY_1]`, the user sees their real key
 * again — restored locally, from a value that never left the machine. This is
 * what makes redaction feel free rather than lossy: without it, every redacted
 * conversation becomes a puzzle the user has to translate in their head.
 *
 * Three rules govern this module:
 *
 *  1. DISPLAY ONLY. Restored values go into elements we create and nothing
 *     else. Nothing is written into an input, a textarea, or any node the host
 *     page might read back and send upstream. A restored value that could
 *     travel back to the model would undo the entire redaction.
 *
 *  2. VISIBLY OURS. The substitution is marked so the user cannot mistake it
 *     for something the model actually returned. Silently rewriting a model's
 *     output would be a worse dishonesty than the inconvenience it solves.
 *
 *  3. FAIL QUIET. A vault miss leaves the placeholder exactly as it is —
 *     which is precisely what was sent, so the page stays truthful.
 */

/** Marks an element as our own substitution. */
export const HYDRATED_ATTR = 'data-apa-hydrated';

/** Holds the placeholder that was actually transmitted. */
export const PLACEHOLDER_ATTR = 'data-apa-placeholder';

/**
 * Regions hydration must never enter.
 *
 * Form controls and editable regions are values the host page reads and can
 * send upstream — a textarea's inner text *is* its value, and a
 * `contenteditable` is the composer itself. `script` and `style` are excluded
 * because injecting an element into either would corrupt it.
 */
const EXCLUDED = 'textarea, input, select, option, script, style, [contenteditable]';

export interface HydrateResult {
  /** How many placeholder occurrences were replaced. */
  replaced: number;
  /** Placeholders found but absent from the vault. */
  missed: string[];
}

/**
 * Collects text nodes that still contain an unhydrated placeholder.
 *
 * Skipping anything already inside a hydrated span is what makes repeated
 * calls safe: our own output contains no placeholders, so a second pass finds
 * nothing and does nothing. That is also what stops the MutationObserver that
 * triggers hydration from looping on the mutations hydration itself causes —
 * no flags or suppression windows needed.
 */
function textNodesWithPlaceholders(root: HTMLElement): Text[] {
  const pattern = placeholderPattern();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`[${HYDRATED_ATTR}]`)) return NodeFilter.FILTER_REJECT;
      // Never touch anything the host page can read back and transmit. A
      // textarea's inner text IS its value, and a contenteditable is the
      // composer itself — writing a restored value into either would hand the
      // secret straight back to the model and undo the redaction entirely.
      if (parent.closest(EXCLUDED)) return NodeFilter.FILTER_REJECT;

      pattern.lastIndex = 0;
      return pattern.test(node.nodeValue ?? '')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

/** Every distinct placeholder appearing in a subtree. */
export function findPlaceholders(root: HTMLElement): string[] {
  const found = new Set<string>();
  for (const node of textNodesWithPlaceholders(root)) {
    for (const match of (node.nodeValue ?? '').matchAll(placeholderPattern())) {
      found.add(match[0]);
    }
  }
  return [...found];
}

/**
 * Builds the element that displays a restored value.
 *
 * Styled with inline properties rather than a stylesheet. These elements live
 * in the HOST page, outside our shadow root, so a stylesheet would mean
 * injecting CSS into ChatGPT's document — breaking the isolation guarantee the
 * whole UI is built on. Inline styles reach exactly our own nodes and nothing
 * else.
 *
 * The underline uses `currentColor`, so it adapts to whatever the host's text
 * colour is without us having to know its theme.
 */
function buildHydratedNode(value: string, placeholder: string): HTMLElement {
  const span = document.createElement('span');
  span.setAttribute(HYDRATED_ATTR, 'true');
  span.setAttribute(PLACEHOLDER_ATTR, placeholder);
  span.textContent = value;

  span.style.borderBottom = '1px dashed currentColor';
  span.style.borderRadius = '2px';
  span.style.padding = '0 1px';
  span.style.cursor = 'help';

  // Hover explains the substitution; the model never saw this value.
  span.title = `Restored locally by AI Prompt Assistant. Sent as ${placeholder}.`;

  return span;
}

/**
 * Replaces placeholders in a subtree with their real values.
 *
 * `resolved` maps placeholder to value. Anything absent is left alone.
 *
 * Every DOM operation is guarded: this runs inside someone else's React tree,
 * and a throw here must never take the page's rendering with it.
 */
export function hydrate(
  root: HTMLElement,
  resolved: Readonly<Record<string, string>>,
): HydrateResult {
  const result: HydrateResult = { replaced: 0, missed: [] };
  const missed = new Set<string>();

  for (const node of textNodesWithPlaceholders(root)) {
    const text = node.nodeValue ?? '';
    const fragment = document.createDocumentFragment();

    let cursor = 0;
    let replacedHere = 0;

    for (const match of text.matchAll(placeholderPattern())) {
      const placeholder = match[0];
      const start = match.index;
      if (start === undefined) continue;

      const value = resolved[placeholder];
      if (value === undefined) {
        // Not in the vault — leave it exactly as sent.
        missed.add(placeholder);
        continue;
      }

      if (start > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
      }
      fragment.appendChild(buildHydratedNode(value, placeholder));

      cursor = start + placeholder.length;
      replacedHere += 1;
    }

    if (replacedHere === 0) continue;

    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }

    try {
      node.parentNode?.replaceChild(fragment, node);
      result.replaced += replacedHere;
    } catch {
      // React may have already replaced this node underneath us. The next
      // mutation brings us back around; a failed swap is not worth a broken
      // page.
    }
  }

  result.missed = [...missed];
  return result;
}

/** Whether a subtree contains anything still needing hydration. */
export function needsHydration(root: HTMLElement): boolean {
  return textNodesWithPlaceholders(root).length > 0;
}

/**
 * Reverses hydration, restoring the placeholders that were transmitted.
 *
 * Used when the user turns re-hydration off, so the page immediately reflects
 * the new setting instead of keeping values on screen they have just asked not
 * to see.
 */
export function dehydrate(root: HTMLElement): number {
  const spans = root.querySelectorAll<HTMLElement>(`[${HYDRATED_ATTR}]`);
  let restored = 0;

  for (const span of spans) {
    const placeholder = span.getAttribute(PLACEHOLDER_ATTR);
    if (!placeholder) continue;

    try {
      span.parentNode?.replaceChild(document.createTextNode(placeholder), span);
      restored += 1;
    } catch {
      /* see hydrate() */
    }
  }

  return restored;
}
