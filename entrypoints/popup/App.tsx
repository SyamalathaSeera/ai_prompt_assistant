/**
 * Toolbar popup.
 *
 * Placeholder until milestone 0.0.6.0, which builds the real surface: catch
 * counts, per-site pause, vault size, and the local-only privacy statement.
 */
function App() {
  return (
    <main className="p-4 text-left">
      <h1 className="text-lg font-semibold tracking-tight">AI Prompt Assistant</h1>
      <p className="mt-2 text-sm opacity-70">
        Protection is active on ChatGPT. Nothing you type leaves this device.
      </p>
      <p className="mt-4 text-xs opacity-50">v{__APP_VERSION__}</p>
    </main>
  );
}

export default App;
