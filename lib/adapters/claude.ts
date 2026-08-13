import { byLargest, bySelector, byVisibleSelector, resolveWithFallback } from './resolve';
import { readBlockEditorText, writeBlockEditorText } from './block-editor';
import type {
  AdapterHealth,
  ChatMessage,
  Disposer,
  PasteEvent,
  SiteAdapter,
  SubmitIntent,
} from './types';

/**
 * Claude adapter — the only module permitted to know what claude.ai's DOM
 * looks like.
 *
 * Selectors verified against the live page on 2026-08-13. What that inspection
 * changed, versus what a reasonable guess would have produced:
 *
 *  - The composer is Tiptap/ProseMirror (`class="tiptap ProseMirror"`), so it
 *    shares ChatGPT's line-break trap. Handled by the shared
 *    `readBlockEditorText`, not reimplemented here.
 *  - Claude ALSO ships a 0×0 disabled `<textarea id="static-composer-input">`
 *    beside the real composer. Same trap as ChatGPT, same guard.
 *  - **There is no `<form>`.** ChatGPT's form-submit interception has no
 *    equivalent here; Enter and the send button are the only paths.
 *  - The send button carries no `data-testid`. Its only stable hook is
 *    `aria-label="Send message"`, which is locale-dependent — hence the
 *    position-based fallback below.
 */

export const CLAUDE_MATCHES = ['https://claude.ai/*'] as const;

/**
 * Composer strategies, most durable first.
 *
 * `data-testid` leads because Claude actually ships one on the composer and it
 * is more stable than its generated classes. `aria-label` is deliberately NOT
 * used — its value is "Write your prompt to Claude", which changes with the
 * user's locale.
 */
const COMPOSER_STRATEGIES = [
  bySelector('testid', '[data-testid="chat-input"][contenteditable="true"]'),
  bySelector('role-textbox', '[contenteditable="true"][role="textbox"]'),
  bySelector('tiptap', '.tiptap[contenteditable="true"]'),
  bySelector('prosemirror', '.ProseMirror[contenteditable="true"]'),
  byLargest('largest-editable', '[contenteditable="true"]'),
  // Last resort. Requires visible layout: the page ships a 0×0 disabled
  // textarea that would otherwise be selected and silently swallow writes.
  byVisibleSelector('visible-textarea', 'textarea:not([disabled])'),
];

/**
 * Send button strategies.
 *
 * The aria-label works today and breaks for any non-English user, so it is
 * backed by a structural strategy: among the buttons that sit alongside the
 * composer, the send control is the rightmost.
 */
const SEND_BUTTON_STRATEGIES = [
  bySelector('aria-label', 'button[aria-label="Send message"]'),
  bySelector('testid', 'button[data-testid="send-button"]'),
  {
    name: 'rightmost-composer-button',
    find: (root: ParentNode): HTMLElement | null => {
      const composer = resolveWithFallback<HTMLElement>(root, COMPOSER_STRATEGIES).element;
      if (!composer) return null;

      // Walk up to a container that holds the composer's controls.
      let container: HTMLElement | null = composer;
      for (let i = 0; i < 8 && container?.parentElement; i += 1) {
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

/**
 * Conversation turns. Verified against a real thread on 2026-08-13: five
 * turns, correctly alternating, none nested inside another.
 *
 * Asymmetric because Claude's markup is. User turns carry a `data-testid`;
 * assistant turns are identified only by a utility class, which is the least
 * durable handle in this adapter and the first thing to check if messages stop
 * being found.
 */
const TURN_SELECTOR = '[data-testid="user-message"], .font-claude-response';

/**
 * True while we are submitting on the user's behalf.
 *
 * A module-level flag rather than a marker on the event, for the reason found
 * in the ChatGPT adapter: a click can cascade into further events that carry
 * none of the first one's properties, and tagging the event lets the cascade
 * through — so the extension intercepts its own submission, forever.
 */
let submittingProgrammatically = false;

function findComposer() {
  return resolveWithFallback<HTMLElement>(document, COMPOSER_STRATEGIES);
}

function findSendButton(): HTMLElement | null {
  return resolveWithFallback<HTMLElement>(document, SEND_BUTTON_STRATEGIES).element;
}

/** Who produced a turn. */
function roleOf(turn: HTMLElement): 'user' | 'assistant' {
  if (turn.getAttribute('data-testid') === 'user-message') return 'user';
  if (turn.closest('[data-testid="user-message"]')) return 'user';
  return 'assistant';
}

export const claudeAdapter: SiteAdapter = {
  id: 'claude',
  hostPatterns: CLAUDE_MATCHES,

  getComposer(): HTMLElement | null {
    return findComposer().element;
  },

  /** See `readBlockEditorText` — Claude has ChatGPT's line-break trap too. */
  getText(el: HTMLElement): string {
    return readBlockEditorText(el);
  },

  /** See `writeBlockEditorText`. */
  setText(el: HTMLElement, text: string): void {
    writeBlockEditorText(el, text);
  },

  /**
   * Subscribes to submission attempts.
   *
   * Capture phase on `document`, so we run before Claude's own handlers. Only
   * two paths exist here — Enter and the send button — because the composer
   * has no form ancestor.
   */
  onSubmitIntent(cb: (intent: SubmitIntent) => void): Disposer {
    // One gesture can still reach us twice if the button emits more than one
    // event, so the same guard as ChatGPT applies.
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
      // Mid-composition Enter commits an IME candidate; it is not a submit.
      if (event.isComposing || event.keyCode === 229) return;

      const composer = findComposer().element;
      if (!composer || !composer.contains(event.target as Node)) return;

      notify('enter', event);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const button = target?.closest?.(
        'button[aria-label="Send message"], button[data-testid="send-button"]',
      );
      if (!button) return;

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

  /**
   * Subscribes to pastes into the composer.
   *
   * Bubble phase and never cancelled — nothing has left the machine by pasting
   * into a textbox, and blocking here would risk breaking paste for no
   * security gain. Submission is the gate; this is early warning.
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

  /** Subscribes to edits. Fires per keystroke — the consumer debounces. */
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

  /**
   * Reads the rendered conversation.
   *
   * `id` is always null: Claude exposes no stable per-message identifier —
   * verified against a real thread on 2026-08-13, where no turn carried a
   * `data-message-id` or equivalent. Reporting null is honest; synthesising an
   * index would look stable and silently change whenever a message is edited
   * or a branch is switched.
   */
  getMessages(): ChatMessage[] {
    return [...document.querySelectorAll<HTMLElement>(TURN_SELECTOR)].map((turn) => ({
      role: roleOf(turn),
      text: turn.textContent ?? '',
      element: turn,
      id: null,
    }));
  },

  /**
   * Identifies the conversation from the URL.
   *
   * Claude uses `/chat/<uuid>`. A new, unsent chat is at `/new` and has no id
   * yet, reported as null rather than invented — a synthesised id would let
   * two different new conversations share vault entries.
   */
  getConversationId(): string | null {
    const match = /\/chat\/([0-9a-f-]{16,})/i.exec(location.pathname);
    return match?.[1] ?? null;
  },

  /**
   * Observes assistant turns as they render and stream.
   *
   * `characterData` is required, not defensive: streamed tokens mutate
   * existing text nodes rather than appending elements, so without it a
   * placeholder arriving mid-stream would never be seen.
   */
  observeResponse(cb: (node: HTMLElement) => void): Disposer {
    // Claude has NO <main> element — verified 2026-08-13. It does expose
    // `[role="main"]`, which is the semantic equivalent and narrower than
    // falling back to <body>, where every unrelated mutation on the page
    // would wake the observer.
    const root =
      document.querySelector<HTMLElement>('[role="main"]') ??
      document.querySelector<HTMLElement>('main') ??
      document.body;

    const notify = (turn: HTMLElement) => {
      try {
        cb(turn);
      } catch {
        /* fail open — the page must render normally regardless */
      }
    };

    const observer = new MutationObserver((records) => {
      const seen = new Set<HTMLElement>();

      const consider = (turn: HTMLElement | null | undefined) => {
        // Only assistant turns are re-hydrated. The user's own text is already
        // theirs, and rewriting it would change what they can see they sent.
        if (!turn || roleOf(turn) !== 'assistant') return;
        if (seen.has(turn)) return;
        seen.add(turn);
        notify(turn);
      };

      for (const record of records) {
        const start =
          record.target.nodeType === Node.ELEMENT_NODE
            ? (record.target as HTMLElement)
            : record.target.parentElement;
        consider(start?.closest<HTMLElement>(TURN_SELECTOR));

        // A new turn arrives inside an added subtree, so it is a DESCENDANT of
        // the added node — `closest` from the target would walk past it.
        for (const added of record.addedNodes) {
          if (added.nodeType !== Node.ELEMENT_NODE) continue;
          const element = added as HTMLElement;

          if (element.matches?.(TURN_SELECTOR)) consider(element);
          element
            .querySelectorAll?.<HTMLElement>(TURN_SELECTOR)
            .forEach((turn) => consider(turn));
        }
      }
    });

    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  },

  checkHealth(): AdapterHealth {
    const composer = findComposer();
    return {
      composerFound: composer.element !== null,
      // No form on Claude, so health is judged on the send control instead.
      submitListenersAttached: findSendButton() !== null,
      resolvedVia: composer.resolvedVia,
    };
  },
};

/**
 * Submits as the user would, by clicking the real send button.
 *
 * The flag spans the whole synchronous cascade so we do not intercept our own
 * submission.
 */
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

