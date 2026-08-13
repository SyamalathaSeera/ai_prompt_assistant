import type { AdapterHealth, Disposer, SiteAdapter, SubmitIntent } from './types';

/**
 * Host match patterns for ChatGPT.
 *
 * Exported so the content script entrypoint and the adapter cannot drift
 * apart. `test/adapter-matches.test.ts` asserts they stay identical — a
 * mismatch would mean the extension either fails to inject or injects
 * somewhere it has no permission for.
 */
export const CHATGPT_MATCHES = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
] as const;

/**
 * ChatGPT adapter. Implemented in milestone 0.0.3.0 Task 2.
 *
 * Implementation notes for that task:
 *  - Prefer stable signals (role, aria-*, contenteditable, element semantics)
 *    over generated class names, with a documented fallback chain.
 *  - setText must dispatch the events ChatGPT's editor listens for, or React
 *    state will not update.
 *  - Re-resolve the composer across SPA navigation via a narrowly scoped
 *    MutationObserver, and disconnect it on teardown.
 *  - Failure must degrade to "extension does nothing", never a broken chat.
 */
export const chatgptAdapter: SiteAdapter = {
  id: 'chatgpt',
  hostPatterns: CHATGPT_MATCHES,

  getComposer(): HTMLElement | null {
    throw new Error('chatgptAdapter.getComposer() is implemented in milestone 0.0.3.0');
  },

  getText(_el: HTMLElement): string {
    throw new Error('chatgptAdapter.getText() is implemented in milestone 0.0.3.0');
  },

  setText(_el: HTMLElement, _text: string): void {
    throw new Error('chatgptAdapter.setText() is implemented in milestone 0.0.3.0');
  },

  onSubmitIntent(_cb: (intent: SubmitIntent) => void): Disposer {
    throw new Error(
      'chatgptAdapter.onSubmitIntent() is implemented in milestone 0.0.3.0',
    );
  },

  checkHealth(): AdapterHealth {
    return { composerFound: false, submitListenersAttached: false, resolvedVia: null };
  },
};
