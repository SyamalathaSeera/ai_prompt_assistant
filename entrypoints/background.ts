import { syncRegistrations } from '@/lib/adapters/platforms';

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
  browser.runtime.onInstalled.addListener(() => void syncRegistrations());

  /**
   * A permission revoked outside our options page — from Chrome's own
   * extension settings — must also drop the registration, or the script would
   * keep trying to inject somewhere it no longer has access.
   */
  browser.permissions.onRemoved?.addListener(() => void syncRegistrations());
  browser.permissions.onAdded?.addListener(() => void syncRegistrations());
});
