import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

/**
 * Confines keyboard focus to the modal, and gives it back when the modal goes.
 *
 * Without a trap, Tab walks out of the dialog and into ChatGPT's page behind
 * it — a keyboard user ends up interacting with a page they cannot see past a
 * modal they cannot leave. Without focus restoration they are dumped at the
 * top of the document and have to navigate back to the composer they were
 * typing in.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0 || true,
  );
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const container = ref.current;
    if (!active || !container) return;

    /**
     * Where focus was before we took it.
     *
     * Read from the host document, not the shadow root: our UI lives in a
     * shadow tree, so `document.activeElement` here is whatever the *page* had
     * focused — which is exactly the composer we want to return them to.
     */
    const previous = document.activeElement as HTMLElement | null;

    // Focus the dialog itself rather than the primary button. The modal is
    // summoned BY pressing Enter, so a focused Send button would let a second
    // reflexive Enter fire it before the user has read anything.
    container.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusable = focusableWithin(container);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      // The keydown originates at the focused element, so `target` identifies
      // it directly. Preferred over `activeElement`, which inside a shadow
      // root reports the shadow HOST from the document's point of view and
      // needs the root queried separately.
      const root = container.getRootNode();
      const current =
        (event.target as HTMLElement | null) ??
        (root instanceof ShadowRoot
          ? (root.activeElement as HTMLElement | null)
          : (document.activeElement as HTMLElement | null));

      if (event.shiftKey && (current === first || current === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);

    return () => {
      container.removeEventListener('keydown', onKeyDown);
      // Hand focus back to whatever the page had, so the user resumes typing
      // where they left off instead of at the top of the document.
      if (previous && previous.isConnected) {
        try {
          previous.focus();
        } catch {
          /* the element may have been replaced mid-navigation */
        }
      }
    };
  }, [ref, active]);
}
