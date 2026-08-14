import { byLargest, bySelector, byVisibleSelector, resolveWithFallback } from './resolve';
import { readBlockEditorText, writeBlockEditorText } from './block-editor';
import { HEURISTIC_COMPOSER_STRATEGIES } from './heuristic';
import type {
  AdapterHealth,
  Disposer,
  PasteEvent,
  SiteAdapter,
  SubmitIntent,
} from './types';

/**
 * Gemini adapter — the only module permitted to know what gemini.google.com's
 * DOM looks like.
 *
 * Selectors verified against the live page on 2026-08-13. What the inspection
 * found:
 *
 *  - The composer is **Quill**, not ProseMirror: `.ql-editor`,
 *    `contenteditable="true"`, `role="textbox"`. A different editor library
 *    that shares the same line-break trap — see `block-editor.ts`.
 *  - A third variant of the decoy element: `.ql-clipboard`, a 0×1
 *    contenteditable that Quill uses for paste handling. Selecting it would
 *    silently swallow writes, exactly as ChatGPT's and Claude's 0×0 textareas
 *    would.
 *  - No `<form>`. Enter and the send button are the only submit paths.
 *  - Angular markup: attributes like `_ngcontent-ng-c3305886920` carry a build
 *    hash and are useless as selectors — they change on every deploy.
 *
 * **Message reading is deliberately unsupported.** See the note on
 * `getMessages` below.
 */

export const GEMINI_MATCHES = ['https://gemini.google.com/*'] as const;

/**
 * Composer strategies, most durable first.
 *
 * `aria-label` is deliberately NOT used — its value is "Enter a prompt for
 * Gemini", which changes with the user's locale.
 */
const COMPOSER_STRATEGIES = [
  // Scoped to exclude .ql-clipboard, Quill's hidden paste buffer.
  bySelector('quill-editor', '.ql-editor[contenteditable="true"]'),
  bySelector('role-textbox', '[contenteditable="true"][role="textbox"]'),
  bySelector('placeholder', '[contenteditable="true"][data-placeholder]'),
  // Largest wins over the 0×1 clipboard element on size alone.
  byLargest('largest-editable', '[contenteditable="true"]:not(.ql-clipboard)'),
  byVisibleSelector('visible-textarea', 'textarea:not([disabled])'),
  // Platform-agnostic recovery, after everything that names gemini.google.com
  // has failed. Reaching these reports as `degraded`, never healthy.
  ...HEURISTIC_COMPOSER_STRATEGIES,
];

/**
 * Send button strategies.
 *
 * `aria-label="Send message"` is the only semantic handle Gemini exposes, and
 * it breaks for every non-English user — so it is backed by a structural
 * strategy that picks the rightmost visible button beside the composer.
 */
const SEND_BUTTON_STRATEGIES = [
  bySelector('aria-label', 'button[aria-label="Send message"]'),
  bySelector('mat-icon-button', 'button[mat-icon-button][aria-label*="Send"]'),
  {
    name: 'rightmost-composer-button',
    find: (root: ParentNode): HTMLElement | null => {
      const composer = resolveWithFallback<HTMLElement>(root, COMPOSER_STRATEGIES).element;
      if (!composer) return null;

      let container: HTMLElement | null = composer;
      for (let i = 0; i < 10 && container?.parentElement; i += 1) {
        container = container.parentElement;
      }
      if (!container) return null;

      const buttons = [...container.querySelectorAll<HTMLElement>('button')].filter(
        (b) => b.getBoundingClientRect().width > 0,
      );
      if (buttons.length === 0) return null;

      return buttons.reduce((rightmost, button) =>
        button.getBoundingClientRect().right > rightmost.getBoundingClientRect().right
          ? button
          : rightmost,
      );
    },
  },
];

/** True while we are submitting on the user's behalf. See the ChatGPT adapter. */
let submittingProgrammatically = false;

function findComposer() {
  return resolveWithFallback<HTMLElement>(document, COMPOSER_STRATEGIES);
}

function findSendButton(): HTMLElement | null {
  return resolveWithFallback<HTMLElement>(document, SEND_BUTTON_STRATEGIES).element;
}

export const geminiAdapter: SiteAdapter = {
  id: 'gemini',
  hostPatterns: GEMINI_MATCHES,

  getComposer(): HTMLElement | null {
    return findComposer().element;
  },

  /** Quill has the same line-break trap as ProseMirror. See `block-editor.ts`. */
  getText(el: HTMLElement): string {
    return readBlockEditorText(el);
  },

  setText(el: HTMLElement, text: string): void {
    writeBlockEditorText(el, text);
  },

  /**
   * Subscribes to submission attempts.
   *
   * Enter and the send button only — Gemini's composer has no form ancestor.
   */
  onSubmitIntent(cb: (intent: SubmitIntent) => void): Disposer {
    let notifiedThisGesture = false;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    const notify = (trigger: SubmitIntent['trigger'], event: Event) => {
      if (submittingProgrammatically) return;
      if (notifiedThisGesture) return;

      notifiedThisGesture = true;
      resetTimer = setTimeout(() => {
        notifiedThisGesture = false;
      }, 0);

      const intent: SubmitIntent = {
        trigger,
        event,
        release: () => submitProgrammatically(),
      };

      try {
        cb(intent);
      } catch {
        /* fail open — see ARCHITECTURE.md pattern 6 */
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      if (event.isComposing || event.keyCode === 229) return;

      const composer = findComposer().element;
      if (!composer || !composer.contains(event.target as Node)) return;

      notify('enter', event);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest?.('button[aria-label="Send message"]')) return;
      notify('button', event);
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClick, true);
      if (resetTimer !== undefined) clearTimeout(resetTimer);
    };
  },

  /** Reports pastes into the composer. Never cancels — submission is the gate. */
  onPaste(cb: (paste: PasteEvent) => void): Disposer {
    const onPasteEvent = (event: ClipboardEvent) => {
      const composer = findComposer().element;
      if (!composer || !composer.contains(event.target as Node)) return;

      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (text === '') return;

      try {
        cb({ text, event });
      } catch {
        /* fail open — a paste must never be broken by our handler */
      }
    };

    document.addEventListener('paste', onPasteEvent);
    return () => document.removeEventListener('paste', onPasteEvent);
  },

  /** Reports edits. Fires per keystroke — the consumer debounces. */
  onInput(cb: () => void): Disposer {
    const onInputEvent = (event: Event) => {
      const composer = findComposer().element;
      if (!composer || !composer.contains(event.target as Node)) return;

      try {
        cb();
      } catch {
        /* fail open — typing must never be disturbed by our handler */
      }
    };

    document.addEventListener('input', onInputEvent);
    return () => document.removeEventListener('input', onInputEvent);
  },

  /*
   * `getMessages` and `observeResponse` are deliberately NOT implemented.
   *
   * Both are optional on `SiteAdapter` precisely so a platform can decline a
   * capability. Gemini's conversation DOM could not be verified on 2026-08-13:
   * the account inspected had no conversation history, so there was no
   * rendered thread to read. Its markup is Angular-generated, where the
   * plausible-looking selectors carry build hashes that change on every
   * deploy.
   *
   * Guessing would produce an adapter that looks complete and silently fails —
   * which is precisely the failure Bug_0001 taught, and re-hydration failing
   * silently is worse than it being absent. The consequence is bounded and
   * honest: on Gemini, secrets are still detected, held, and redacted; only
   * the restoration of values in replies is missing, and the placeholder
   * simply stays visible, which is exactly what was sent.
   *
   * To finish this: open a Gemini conversation with several turns, inspect the
   * turn container and role markers as was done for ChatGPT and Claude, then
   * implement both methods and add the fixture.
   */

  checkHealth(): AdapterHealth {
    const composer = findComposer();
    return {
      composerFound: composer.element !== null,
      submitListenersAttached: findSendButton() !== null,
      resolvedVia: composer.resolvedVia,
    };
  },
};

function submitProgrammatically(): void {
  const button = findSendButton();
  if (!button) return;

  submittingProgrammatically = true;
  try {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  } finally {
    setTimeout(() => {
      submittingProgrammatically = false;
    }, 0);
  }
}
