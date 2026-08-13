import { useCallback, useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { purge, size, TTL_MS } from '@/lib/vault';
import { countRecent, getCounters, getSettings, setSettings } from '@/lib/storage';
import { PAUSE_DURATION_MS } from '@/lib/policy/defaults';
import { isPaused } from '@/lib/interception/controller';
import { isSupportedHost } from '@/lib/adapters/registry';
import type { Settings } from '@/lib/policy/schema';

/**
 * Toolbar popup.
 *
 * Answers three questions, in the order someone actually asks them:
 *
 *   1. Is it working right now?          — status line
 *   2. Has it done anything for me?      — catch counts
 *   3. What do you have of mine?         — vault count and clear
 *
 * The second is the retention surface. A passive security tool is invisible
 * when it works, so a user who never sees evidence of it working concludes it
 * does nothing and removes it.
 */

/** Version from the manifest — what actually shipped, and no bundler define. */
function version(): string {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return '';
  }
}

/**
 * Hostname of the active tab.
 *
 * Deliberately does NOT request the `tabs` permission, which would put "Read
 * your browsing history" on the install screen. Chrome populates `url` for
 * tabs we already hold host permission for, so a ChatGPT tab is visible and
 * everything else is correctly opaque to us.
 */
async function activeHostname(): Promise<string | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    return new URL(tab.url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function minutesLeft(until: number, now = Date.now()): number {
  return Math.max(1, Math.ceil((until - now) / 60_000));
}

function App() {
  const [settings, setLocalSettings] = useState<Settings | null>(null);
  const [host, setHost] = useState<string | null>(null);
  const [week, setWeek] = useState(0);
  const [total, setTotal] = useState(0);
  const [held, setHeld] = useState(0);

  const refresh = useCallback(() => {
    void getSettings().then(setLocalSettings);
    void activeHostname().then(setHost);
    void countRecent(7).then(setWeek);
    void getCounters().then((c) => setTotal(c.totalCatches));
    void size()
      .then(setHeld)
      .catch(() => setHeld(0));
  }, []);

  useEffect(refresh, [refresh]);

  const update = async (patch: Partial<Settings>) => {
    setLocalSettings(await setSettings(patch));
  };

  if (!settings) {
    return (
      <main className="p-4">
        <p className="text-sm opacity-60">Loading…</p>
      </main>
    );
  }

  const supported = host !== null && isSupportedHost(host);
  const hostPaused = host !== null && settings.pausedHosts.includes(host);
  const timedPause =
    settings.pausedUntil !== null && Date.now() < settings.pausedUntil
      ? settings.pausedUntil
      : null;

  // The status dot uses the SAME predicate the interception controller uses,
  // so the popup can never claim protection the content script is not
  // actually providing. The breakdown above is only for wording the message.
  const active = settings.enabled && !isPaused(settings, host ?? '');

  const status = !settings.enabled
    ? 'Turned off'
    : timedPause !== null
      ? `Paused for ${minutesLeft(timedPause)} more minutes`
      : hostPaused
        ? `Paused on ${host}`
        : supported
          ? 'Protecting this tab'
          : 'Active on supported AI chats';

  return (
    <main className="p-4 text-left">
      <header className="flex items-baseline justify-between gap-2">
        <h1 className="text-base font-semibold tracking-tight">AI Prompt Assistant</h1>
        <span
          data-testid="status-dot"
          data-active={active}
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ background: active ? '#16a34a' : '#a1a1aa' }}
        />
      </header>

      <p className="mt-1 text-sm opacity-70" data-testid="status">
        {status}
      </p>

      <section className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-current/15 p-3">
          <div className="text-xl font-semibold tabular-nums" data-testid="count-week">
            {week}
          </div>
          <div className="text-xs opacity-60">caught this week</div>
        </div>
        <div className="rounded-lg border border-current/15 p-3">
          <div className="text-xl font-semibold tabular-nums" data-testid="count-total">
            {total}
          </div>
          <div className="text-xs opacity-60">caught in total</div>
        </div>
      </section>

      <section className="mt-3 flex flex-wrap gap-2">
        {timedPause === null ? (
          <button
            type="button"
            data-testid="pause-timed"
            onClick={() => update({ pausedUntil: Date.now() + PAUSE_DURATION_MS })}
            className="rounded-md border border-current/25 px-2.5 py-1.5 text-xs"
          >
            Pause {Math.round(PAUSE_DURATION_MS / 60_000)} min
          </button>
        ) : (
          <button
            type="button"
            data-testid="pause-resume"
            onClick={() => update({ pausedUntil: null })}
            className="rounded-md border border-current/25 px-2.5 py-1.5 text-xs"
          >
            Resume now
          </button>
        )}

        {supported && host !== null && (
          <button
            type="button"
            data-testid="pause-site"
            onClick={() =>
              update({
                pausedHosts: hostPaused
                  ? settings.pausedHosts.filter((h) => h !== host)
                  : [...settings.pausedHosts, host],
              })
            }
            className="rounded-md border border-current/25 px-2.5 py-1.5 text-xs"
          >
            {hostPaused ? `Resume on ${host}` : `Pause on ${host}`}
          </button>
        )}
      </section>

      <section className="mt-4 rounded-lg border border-current/15 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium">Restorable values</span>
          <span className="tabular-nums text-sm" data-testid="vault-count">
            {held}
          </span>
        </div>

        <p className="mt-1 text-xs opacity-60">
          Held in memory so redacted replies can be restored. Cleared when you close
          the browser, or after {Math.round(TTL_MS / (60 * 60 * 1000))} hours unused.
        </p>

        <button
          type="button"
          data-testid="vault-clear"
          onClick={() => void purge().then(refresh)}
          disabled={held === 0}
          className="mt-3 rounded-md border border-current/25 px-2.5 py-1.5 text-xs disabled:opacity-40"
        >
          Clear now
        </button>
      </section>

      <p className="mt-4 text-xs opacity-60">
        Detection runs entirely on this device. Nothing you type leaves this device.
      </p>

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          data-testid="open-options"
          onClick={() => void browser.runtime.openOptionsPage()}
          className="text-xs underline underline-offset-2"
        >
          All settings
        </button>
        <span className="text-xs opacity-50" data-testid="version">
          v{version()}
        </span>
      </div>
    </main>
  );
}

export default App;
