import { useCallback, useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { purge, size, TTL_MS } from '@/lib/vault';

/**
 * Version from the manifest rather than a build-time constant.
 *
 * The manifest is what actually shipped, so this cannot disagree with the
 * installed extension — and it needs no bundler define, which means the
 * component renders the same way under test as in the browser.
 */
function version(): string {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return '';
  }
}

/**
 * Toolbar popup.
 *
 * Its job right now is the vault: showing what is held and letting the user
 * clear it. A tool that keeps secrets in memory has to be able to answer
 * "what do you have of mine?" — and answer it without displaying the values,
 * which would make the popup a leak of its own.
 *
 * Catch counts, per-site pause, and full settings arrive in milestone 0.0.6.0.
 */
function App() {
  const [held, setHeld] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(() => {
    size()
      .then(setHeld)
      .catch(() => setHeld(0));
  }, []);

  useEffect(refresh, [refresh]);

  const clear = async () => {
    setClearing(true);
    try {
      await purge();
    } finally {
      setClearing(false);
      refresh();
    }
  };

  const hours = Math.round(TTL_MS / (60 * 60 * 1000));

  return (
    <main className="p-4 text-left">
      <h1 className="text-base font-semibold tracking-tight">AI Prompt Assistant</h1>
      <p className="mt-1 text-sm opacity-70">
        Protection is active on ChatGPT. Nothing you type leaves this device.
      </p>

      <section className="mt-4 rounded-lg border border-current/15 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium">Restorable values</span>
          <span className="tabular-nums text-sm" data-testid="vault-count">
            {held === null ? '—' : held}
          </span>
        </div>

        <p className="mt-1 text-xs opacity-60">
          Held in memory so redacted replies can be restored. Cleared when you close
          the browser, or after {hours} hours unused.
        </p>

        <button
          type="button"
          data-testid="vault-clear"
          onClick={clear}
          disabled={clearing || held === 0}
          className="mt-3 rounded-md border border-current/25 px-2.5 py-1.5 text-xs disabled:opacity-40"
        >
          {clearing ? 'Clearing…' : 'Clear now'}
        </button>
      </section>

      <p className="mt-4 text-xs opacity-50" data-testid="version">
        v{version()}
      </p>
    </main>
  );
}

export default App;
