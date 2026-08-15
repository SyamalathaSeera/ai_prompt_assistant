import { browser } from 'wxt/browser';
import { countRecent } from '../storage';

/**
 * The toolbar badge.
 *
 * A passive security tool has a structural problem: when it works, nothing
 * happens. The badge is the cheapest possible answer to "why do I still have
 * this installed" — a number the user passes a hundred times a day without
 * having to open anything.
 *
 * Deliberately a **recent** count rather than a lifetime total. A lifetime
 * number stops moving and becomes wallpaper; "3 this week" is a fact about now,
 * and it goes back to nothing when the extension has genuinely done nothing.
 * That honesty is the point — a badge that always shows a big number is an
 * advert, not information.
 *
 * Driven by a storage change rather than by a message from the content script.
 * The catch is already written to `.local` by `recordCatch`, so watching that
 * key means there is no second code path to keep in step, and the badge updates
 * whichever surface recorded the catch.
 */

/** Days of history the badge reflects. Matches the popup's "this week". */
export const BADGE_WINDOW_DAYS = 7;

/**
 * Above this, the exact number stops mattering.
 *
 * Chrome truncates badge text past about four characters anyway, and the
 * difference between 100 and 137 catches is not a difference the user acts on.
 */
const MAX_DISPLAYED = 99;

/** Badge text for a count. Empty string means no badge at all. */
export function badgeTextFor(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > MAX_DISPLAYED ? `${MAX_DISPLAYED}+` : String(count);
}

/**
 * Recomputes and applies the badge.
 *
 * Best-effort throughout. A badge that fails to render is a cosmetic loss; an
 * exception escaping into the service worker's startup path is not.
 */
export async function refreshBadge(): Promise<void> {
  try {
    const count = await countRecent(BADGE_WINDOW_DAYS);
    const text = badgeTextFor(count);

    await browser.action?.setBadgeText({ text });

    if (text !== '') {
      // Amber rather than red. The catches already happened and were handled —
      // this is a record of work done, not an alarm about a live problem.
      await browser.action?.setBadgeBackgroundColor?.({ color: '#b45309' });
    }
  } catch {
    /* the badge is never worth breaking anything for */
  }
}

/**
 * Keeps the badge in step with the counters.
 *
 * Returns a disposer. The listener is scoped to the counters key so ordinary
 * settings writes do not cause a storage read on every toggle.
 */
export function watchCounters(countersKey = 'apa:counters'): () => void {
  const onChanged = (
    changes: Record<string, unknown>,
    area: string,
  ) => {
    if (area !== 'local') return;
    if (!(countersKey in changes)) return;
    void refreshBadge();
  };

  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
