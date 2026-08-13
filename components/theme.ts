export type Theme = 'light' | 'dark';

/**
 * Theme detection for injected UI.
 *
 * Our panel sits inside a shadow root on someone else's page, so the theme
 * that matters is the HOST PAGE'S, not the operating system's. A user running
 * ChatGPT in dark mode on a light-themed OS would otherwise get a bright white
 * panel over a dark chat — jarring, and it makes the extension look like it
 * does not belong there.
 *
 * Resolution order: an explicit signal from the host page first, then the OS
 * preference as a fallback.
 */

/** Attributes and classes host pages use to declare an explicit theme. */
function readExplicitTheme(root: HTMLElement): Theme | null {
  const dataTheme = root.getAttribute('data-theme')?.toLowerCase();
  if (dataTheme === 'dark' || dataTheme === 'light') return dataTheme;

  const colorScheme = root.style.colorScheme?.toLowerCase();
  if (colorScheme === 'dark') return 'dark';
  if (colorScheme === 'light') return 'light';

  // ChatGPT and most Tailwind-based apps toggle a class on <html>.
  if (root.classList.contains('dark')) return 'dark';
  if (root.classList.contains('light')) return 'light';

  return null;
}

function prefersDark(): boolean {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  } catch {
    return false;
  }
}

/** Current theme, preferring the host page's declaration over the OS setting. */
export function detectTheme(root: HTMLElement = document.documentElement): Theme {
  return readExplicitTheme(root) ?? (prefersDark() ? 'dark' : 'light');
}

/**
 * Watches for theme changes and reports the new value.
 *
 * Fires only on an actual change — host pages mutate `<html>` constantly for
 * unrelated reasons, and re-rendering on each one would be wasted work.
 *
 * Returns a disposer.
 */
export function observeTheme(
  onChange: (theme: Theme) => void,
  root: HTMLElement = document.documentElement,
): () => void {
  let current = detectTheme(root);

  const check = () => {
    const next = detectTheme(root);
    if (next === current) return;
    current = next;
    onChange(next);
  };

  const observer = new MutationObserver(check);
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'style'],
  });

  let media: MediaQueryList | undefined;
  try {
    media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', check);
  } catch {
    /* matchMedia unavailable — the MutationObserver still covers the host */
  }

  return () => {
    observer.disconnect();
    media?.removeEventListener('change', check);
  };
}
