import { syncRegistrations } from '@/lib/adapters/platforms';
import { dispatchRefineToActiveTab, REFINE_COMMAND } from '@/lib/messaging';
import { refreshBadge, watchCounters } from '@/lib/badge';

export default defineBackground(() => {
  /**
   * Let the content script read and write `storage.session`.
   *
   * Session storage defaults to trusted contexts only, which excludes content
   * scripts — and the content script is where re-hydration happens, so
   * without this the vault would be unreachable by the only code that needs
   * it.
   *
   * This does NOT expose the vault to the web page. Content scripts run in an
   * isolated world: page JavaScript cannot see `chrome.storage` at all, and
   * neither can other extensions. The boundary that matters is unchanged.
   *
   * Routing through the background worker instead was considered and rejected:
   * re-hydration has to render the plaintext in the page regardless, so
   * message-passing would add a hop without moving a single secret out of the
   * content script's reach.
   */
  browser.storage.session
    .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
    .catch(() => {
      // Older browsers lack setAccessLevel. Re-hydration degrades to showing
      // placeholders unchanged, which is exactly what was sent — never an error.
    });

  /**
   * Keep content script registrations in step with granted permissions.
   *
   * Dynamic registrations survive a browser restart, but not every path — an
   * extension update can clear them while the host permission remains. A user
   * who enabled Claude months ago would then quietly stop being protected on
   * it, with the options page still showing the toggle on.
   *
   * Running this on both startup and install makes the two states agree again.
   */
  void syncRegistrations();
  browser.runtime.onStartup.addListener(() => void syncRegistrations());

  /**
   * The toolbar badge.
   *
   * Watches the counters key rather than listening for a message from the
   * content script. The catch is already written to storage, so there is no
   * second path to keep in step — and the badge is correct no matter which
   * surface recorded it.
   *
   * Refreshed on startup too: a service worker that was asleep when the window
   * opened would otherwise show nothing until the next catch.
   */
  void refreshBadge();
  browser.runtime.onStartup.addListener(() => void refreshBadge());
  watchCounters();

  browser.runtime.onInstalled.addListener((details) => {
    void syncRegistrations();

    /**
     * The welcome page, on first install only.
     *
     * A passive security tool has a structural problem: when it works, nothing
     * happens. Someone who installs this and sees no change removes it within a
     * fortnight, so the page exists to make a catch happen once, deliberately,
     * before they are anywhere near a real conversation.
     *
     * **Only `install`.** An update firing this would open a tab in the face of
     * someone mid-task who did not ask for it — and would do so on every release
     * forever. `chrome_update` and `shared_module_update` are filtered out by
     * the same check; only a genuine first install gets a tab.
     */
    if (details.reason !== 'install') return;

    browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') }).catch(() => {
      /* a welcome tab that fails to open must never break the install */
    });
  });

  /**
   * A permission revoked outside our options page — from Chrome's own
   * extension settings — must also drop the registration, or the script would
   * keep trying to inject somewhere it no longer has access.
   */
  browser.permissions.onRemoved?.addListener(() => void syncRegistrations());
  browser.permissions.onAdded?.addListener(() => void syncRegistrations());

  /**
   * The refinement shortcut.
   *
   * Commands are delivered here and nowhere else, so the background worker
   * forwards it to the tab in front of the user. It carries no text: the
   * content script reads the composer itself, and the prompt never travels
   * through the worker.
   */
  browser.commands?.onCommand.addListener((command) => {
    if (command !== REFINE_COMMAND) return;
    void dispatchRefineToActiveTab();
  });
});
