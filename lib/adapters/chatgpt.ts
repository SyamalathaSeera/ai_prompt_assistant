import { byLargest, bySelector, byVisibleSelector, resolveWithFallback } from './resolve';
import type {
  AdapterHealth,
  ChatMessage,
  Disposer,
  PasteEvent,
  SiteAdapter,
  SubmitIntent,
} from './types';

/**
 * ChatGPT adapter — the only module permitted to know what chatgpt.com's DOM
 * looks like.
 *
 * Selectors below were verified against the live page on 2026-08-12. Findings
 * that shaped this file:
 *
 *  - The composer is a ProseMirror `contenteditable` DIV with
 *    `id="prompt-textarea"` and `role="textbox"`. Despite the id, it is not a
 *    textarea.
 *  - The page ALSO ships a 0×0 `<textarea name="prompt-textarea">` fallback.
 *    It is connected and unhidden, so naive checks accept it, but writing into
 *    it does nothing visible. Every composer strategy here targets the
 *    contenteditable, and the one textarea fallback requires visible layout.
 *  - The send button only exists in the DOM once the composer has content. Its
 *    stable hooks are `data-testid="send-button"` and
 *    `id="composer-submit-button"`.
 *  - There is a real `<form>` ancestor, so form submission is interceptable.
 */

export const CHATGPT_MATCHES = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
] as const;

/**
 * Composer strategies, most durable first.
 *
 * The id is listed first because it is what ChatGPT actually ships and is
 * cheap to check; the semantic strategies below it are what survive an id
 * change. `aria-label` is deliberately NOT used — its value is
 * "Chat with ChatGPT", which changes with the user's locale.
 */
const COMPOSER_STRATEGIES = [
  bySelector('id', '#prompt-textarea[contenteditable="true"]'),
  bySelector('role-textbox', '[contenteditable="true"][role="textbox"]'),
  bySelector('prosemirror', '.ProseMirror[contenteditable="true"]'),
  byLargest('largest-editable', '[contenteditable="true"]'),
  // Last resort, and the reason `byVisibleSelector` exists: an invisible
  // textarea would otherwise be selected here and silently swallow writes.
  byVisibleSelector('visible-textarea', 'form textarea'),
];

const SEND_BUTTON_STRATEGIES = [
  bySelector('testid', '[data-testid="send-button"]'),
  bySelector('id', '#composer-submit-button'),
  bySelector('aria-label', 'form button[aria-label="Send prompt"]'),
];

/**
 * True while we are submitting on the user's behalf.
 *
 * Deliberately a module-level flag rather than a marker on the event object.
 * Clicking the send button cascades into a separate `submit` event, and that
 * second event carries none of the first one's properties — so an
 * event-tagging approach lets the cascade through and we intercept our own
 * submission, forever. A flag spanning the whole cascade is the only thing
 * that actually closes the loop.
 */
let submittingProgrammatically = false;

function findComposer() {
  return resolveWithFallback<HTMLElement>(document, COMPOSER_STRATEGIES);
}

function findSendButton(): HTMLElement | null {
  return resolveWithFallback<HTMLElement>(document, SEND_BUTTON_STRATEGIES).element;
}

export const chatgptAdapter: SiteAdapter = {
  id: 'chatgpt',
  hostPatterns: CHATGPT_MATCHES,

  getComposer(): HTMLElement | null {
    return findComposer().element;
  },

  getText(el: HTMLElement): string {
    // ProseMirror renders an empty document as a single <p><br></p>, which
    // reads as an empty string via textContent — which is what we want.
    if (el instanceof HTMLTextAreaElement) return el.value;
    return el.textContent ?? '';
  },

  /**
   * Replaces the composer's content.
   *
   * Goes through `execCommand('insertText')` rather than assigning
   * `textContent`. execCommand routes through the browser's native editing
   * pipeline, which ProseMirror handles exactly as it handles a real user
   * edit, so its internal document state cannot drift from the DOM.
   *
   * That distinction is the difference between a redaction that works and one
   * that appears to work: if ProseMirror's document were stale at submit time,
   * ChatGPT would send the ORIGINAL text while the user believed it had been
   * redacted. Direct assignment was observed to stay in sync on 2026-08-12,
   * but that relies on ProseMirror's mutation observer — undocumented
   * behaviour to bet a security guarantee on. The assignment path is kept only
   * as a fallback for when execCommand is unavailable.
   */
  setText(el: HTMLElement, text: string): void {
    if (el instanceof HTMLTextAreaElement) {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    el.focus();

    let inserted = false;
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);

      inserted = document.execCommand('insertText', false, text);
    } catch {
      inserted = false;
    }

    if (inserted) return;

    el.textContent = text;
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
    );
  },

  /**
   * Subscribes to submission attempts.
   *
   * Listeners are registered in the CAPTURE phase on `document` so they run
   * before ChatGPT's own handlers — by the time a bubbling listener fires, the
   * request is already on its way.
   *
   * Three paths reach submission and all three are covered: Enter in the
   * composer, a click on the send button, and form submit.
   */
  onSubmitIntent(cb: (intent: SubmitIntent) => void): Disposer {
    /**
     * One user gesture reaches us through more than one path.
     *
     * The send button carries no `type` attribute, so inside a `<form>` it
     * defaults to `type="submit"` — a single click fires our click listener
     * AND a submit event immediately after. Without this guard the user would
     * be asked to approve the same prompt twice.
     *
     * Reset on a macrotask, which covers the synchronous click → submit chain
     * while still allowing a genuine second submission moments later.
     */
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

      // A throw here must not swallow the user's submission, so the caller's
      // failure is contained and the event proceeds untouched.
      try {
        cb(intent);
      } catch {
        /* fail open — see ARCHITECTURE.md pattern 6 */
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      // Mid-composition Enter commits an IME candidate; it is not a submit.
      if (event.isComposing || event.keyCode === 229) return;

      const composer = findComposer().element;
      if (!composer || !composer.contains(event.target as Node)) return;

      notify('enter', event);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const button = target?.closest?.(
        '[data-testid="send-button"], #composer-submit-button',
      );
      if (!button) return;

      notify('button', event);
    };

    const onSubmit = (event: Event) => notify('form', event);

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
      if (resetTimer !== undefined) clearTimeout(resetTimer);
    };
  },

  /**
   * Subscribes to pastes into the composer.
   *
   * Bubble phase, not capture, and never cancelled. The paste is allowed to
   * land normally — nothing has left the machine by pasting into a textbox,
   * and blocking here would risk breaking paste entirely for no security gain.
   * Submission is the gate; this is early warning.
   */
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

  /**
   * Subscribes to edits in the composer.
   *
   * Passive and never cancelled. Fires per keystroke — debouncing is the
   * consumer's job, since only it knows what the scan costs.
   */
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

  getMessages(): ChatMessage[] {
    // Message DOM could not be verified on 2026-08-12 — the inspected page was
    // a fresh conversation with no turns rendered. Deliberately returns empty
    // rather than guessing at selectors: re-hydration (milestone 0.0.5.0) is
    // the first consumer, and it can be built against a page that has messages.
    return [];
  },

  checkHealth(): AdapterHealth {
    const composer = findComposer();
    return {
      composerFound: composer.element !== null,
      submitListenersAttached: document.querySelector('form') !== null,
      resolvedVia: composer.resolvedVia,
    };
  },
};

/**
 * Submits the composer as the user would.
 *
 * Clicks the real send button rather than dispatching a synthetic Enter, so
 * ChatGPT's own submission path runs unchanged. The click is tagged so our
 * capture-phase listener ignores it and we do not intercept ourselves into a
 * loop.
 */
function submitProgrammatically(): void {
  const button = findSendButton();
  if (!button) return;

  submittingProgrammatically = true;
  try {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  } finally {
    // Cleared on a macrotask so the whole synchronous cascade — click, then
    // the form's submit event — is covered before we start listening again.
    setTimeout(() => {
      submittingProgrammatically = false;
    }, 0);
  }
}
