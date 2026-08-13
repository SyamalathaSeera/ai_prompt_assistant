export default defineContentScript({
  // Must stay identical to CHATGPT_MATCHES in lib/adapters/chatgpt.ts.
  // WXT extracts these at build time, so they are written as literals rather
  // than imported. test/adapter-matches.test.ts asserts the two stay in sync —
  // drift would mean the extension either fails to inject or tries to inject
  // where it holds no host permission.
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],

  main() {
    // Milestone 0.0.3.0 wires the adapter, detector, and interception here.
    // For now this only proves injection works, and which build is live.
    console.log(`[APA] content script active v${__APP_VERSION__}`);
  },
});
