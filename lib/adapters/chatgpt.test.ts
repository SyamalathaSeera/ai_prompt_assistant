import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatgptAdapter } from './chatgpt';
import type { SubmitIntent } from './types';

/**
 * ChatGPT adapter tests.
 *
 * The fixture mirrors the real DOM as inspected on 2026-08-12, including the
 * 0×0 fallback textarea that sits alongside the real composer. Reproducing
 * that decoy is the point: it is exactly the trap a naive implementation falls
 * into, and jsdom will not surface it on its own.
 */

/** Gives an element a non-zero rect, since jsdom reports 0×0 for everything. */
function withLayout(el: Element, width = 400, height = 40): void {
  el.getBoundingClientRect = () => ({ width, height }) as DOMRect;
}

function mountChatGpt(): { composer: HTMLElement; form: HTMLFormElement } {
  document.body.innerHTML = `
    <main>
      <form>
        <div>
          <div id="prompt-textarea" contenteditable="true" role="textbox"
               class="ProseMirror" aria-label="Chat with ChatGPT"></div>
        </div>
        <textarea name="prompt-textarea"></textarea>
        <button id="composer-plus-btn" data-testid="composer-plus-btn" type="button"></button>
        <button id="composer-submit-button" data-testid="send-button"
                aria-label="Send prompt"></button>
      </form>
    </main>
  `;

  const composer = document.getElementById('prompt-textarea')!;
  const fallback = document.querySelector('textarea')!;

  withLayout(composer);
  // The real page ships this at 0×0 — reproduce it faithfully.
  withLayout(fallback, 0, 0);

  return { composer, form: document.querySelector('form')! };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('getComposer', () => {
  it('finds the ProseMirror composer', () => {
    const { composer } = mountChatGpt();
    expect(chatgptAdapter.getComposer()).toBe(composer);
  });

  it('never selects the 0×0 fallback textarea', () => {
    // The decoy is connected, unhidden, and not aria-hidden, so it passes
    // every naive check. Writing into it would silently do nothing.
    mountChatGpt();
    const found = chatgptAdapter.getComposer();
    expect(found?.tagName.toLowerCase()).not.toBe('textarea');
    expect(found?.id).toBe('prompt-textarea');
  });

  it('falls back to the semantic selector when the id changes', () => {
    const { composer } = mountChatGpt();
    composer.removeAttribute('id');
    expect(chatgptAdapter.getComposer()).toBe(composer);
    expect(chatgptAdapter.checkHealth().resolvedVia).toBe('role-textbox');
  });

  it('falls back to the ProseMirror class when id and role are both gone', () => {
    const { composer } = mountChatGpt();
    composer.removeAttribute('id');
    composer.removeAttribute('role');
    expect(chatgptAdapter.getComposer()).toBe(composer);
    expect(chatgptAdapter.checkHealth().resolvedVia).toBe('prosemirror');
  });

  it('returns null on a page with no composer, without throwing', () => {
    document.body.innerHTML = '<main><p>no composer</p></main>';
    expect(chatgptAdapter.getComposer()).toBeNull();
  });
});

describe('getText / setText', () => {
  /**
   * Fills the composer the way ProseMirror does: one block element per line.
   *
   * The original fixture assigned flat text to the container, which is not
   * what the real editor produces — and that gap hid a bug where multi-line
   * prompts were read with their line boundaries erased.
   */
  function fillLines(composer: HTMLElement, lines: string[]): void {
    composer.innerHTML = '';
    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line;
      composer.appendChild(p);
    }
  }

  it('reads the composer text', () => {
    const { composer } = mountChatGpt();
    fillLines(composer, ['hello there']);
    expect(chatgptAdapter.getText(composer)).toBe('hello there');
  });

  it('reads empty for a fresh composer', () => {
    const { composer } = mountChatGpt();
    expect(chatgptAdapter.getText(composer)).toBe('');
  });

  it('preserves line breaks across ProseMirror blocks', () => {
    // textContent concatenates block elements with no separator, which glues
    // one line to the next. Rules anchored with \b then stop matching, so a
    // secret at a line boundary is silently missed — in a pasted .env file,
    // which is the most common way this product is used.
    const { composer } = mountChatGpt();
    fillLines(composer, [
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      'DATABASE_URL=postgres://app:hunter2pass@db.internal:5432/orders',
    ]);

    const text = chatgptAdapter.getText(composer);

    expect(text).toBe(
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n' +
        'DATABASE_URL=postgres://app:hunter2pass@db.internal:5432/orders',
    );
    expect(/\bAKIA[0-9A-Z]{16}\b/.test(text)).toBe(true);
  });

  it('keeps blank lines, which ProseMirror renders as empty paragraphs', () => {
    const { composer } = mountChatGpt();
    fillLines(composer, ['first', '', 'third']);
    expect(chatgptAdapter.getText(composer)).toBe('first\n\nthird');
  });

  it('handles a plain contenteditable with no block children', () => {
    const { composer } = mountChatGpt();
    composer.textContent = 'flat text';
    expect(chatgptAdapter.getText(composer)).toBe('flat text');
  });

  it('writes text and fires an input event so the editor re-syncs', () => {
    const { composer } = mountChatGpt();
    const onInput = vi.fn();
    composer.addEventListener('input', onInput);

    chatgptAdapter.setText(composer, 'AWS_KEY=[REDACTED_AWS_ACCESS_KEY_ID_1]');

    expect(chatgptAdapter.getText(composer)).toBe(
      'AWS_KEY=[REDACTED_AWS_ACCESS_KEY_ID_1]',
    );
    // execCommand does not exist in jsdom, so the fallback path runs here —
    // which is precisely the path that must dispatch an input event.
    expect(onInput).toHaveBeenCalled();
  });

  it('round-trips a multi-line value', () => {
    const { composer } = mountChatGpt();
    const text = 'line one\nline two\nline three';
    chatgptAdapter.setText(composer, text);
    expect(chatgptAdapter.getText(composer)).toBe(text);
  });
});

describe('onSubmitIntent', () => {
  it('fires on Enter inside the composer', () => {
    const { composer } = mountChatGpt();
    const seen: SubmitIntent[] = [];
    const dispose = chatgptAdapter.onSubmitIntent((i) => seen.push(i));

    composer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]!.trigger).toBe('enter');
    dispose();
  });

  it('ignores Shift+Enter, which inserts a newline', () => {
    const { composer } = mountChatGpt();
    const seen: SubmitIntent[] = [];
    const dispose = chatgptAdapter.onSubmitIntent((i) => seen.push(i));

    composer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
    );

    expect(seen).toEqual([]);
    dispose();
  });

  it('ignores Enter during IME composition', () => {
    // Committing a Japanese or Chinese candidate uses Enter. Treating that as
    // a submit would make the extension actively hostile to those users.
    const { composer } = mountChatGpt();
    const seen: SubmitIntent[] = [];
    const dispose = chatgptAdapter.onSubmitIntent((i) => seen.push(i));

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(event, 'isComposing', { value: true });
    composer.dispatchEvent(event);

    expect(seen).toEqual([]);
    dispose();
  });

  it('ignores Enter outside the composer', () => {
    mountChatGpt();
    const seen: SubmitIntent[] = [];
    const dispose = chatgptAdapter.onSubmitIntent((i) => seen.push(i));

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    expect(seen).toEqual([]);
    dispose();
  });

  it('fires exactly once on a send button click', () => {
    // The send button has no `type` attribute, so inside a form it defaults to
    // type="submit" — one click fires our click listener AND a submit event.
    // The user performed one action and must be asked once.
    mountChatGpt();
    const seen: SubmitIntent[] = [];
    const dispose = chatgptAdapter.onSubmitIntent((i) => seen.push(i));

    document
      .querySelector<HTMLElement>('[data-testid="send-button"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(seen.map((i) => i.trigger)).toEqual(['button']);
    dispose();
  });

  it('fires once when Enter cascades into a form submit', () => {
    const { composer, form } = mountChatGpt();
    const seen: SubmitIntent[] = [];
    const dispose = chatgptAdapter.onSubmitIntent((i) => seen.push(i));

    composer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(seen.map((i) => i.trigger)).toEqual(['enter']);
    dispose();
  });

  it('ignores clicks on other composer buttons', () => {
    mountChatGpt();
    const seen: SubmitIntent[] = [];
    const dispose = chatgptAdapter.onSubmitIntent((i) => seen.push(i));

    document
      .querySelector<HTMLElement>('#composer-plus-btn')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(seen).toEqual([]);
    dispose();
  });

  it('fires on form submit', () => {
    const { form } = mountChatGpt();
    const seen: SubmitIntent[] = [];
    const dispose = chatgptAdapter.onSubmitIntent((i) => seen.push(i));

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(seen).toHaveLength(1);
    expect(seen[0]!.trigger).toBe('form');
    dispose();
  });

  it('lets the handler cancel the event', () => {
    const { composer } = mountChatGpt();
    const dispose = chatgptAdapter.onSubmitIntent((intent) => {
      intent.event.preventDefault();
    });

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    composer.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    dispose();
  });

  it('does not re-intercept its own programmatic submit, including the cascade', async () => {
    // release() clicks the real send button, which cascades into a separate
    // form submit event. Both must be ignored — otherwise the extension
    // intercepts its own submission and loops forever.
    mountChatGpt();
    const seen: SubmitIntent[] = [];
    const dispose = chatgptAdapter.onSubmitIntent((i) => seen.push(i));

    document
      .querySelector<HTMLElement>('[data-testid="send-button"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(seen).toHaveLength(1);

    // Let the gesture guard reset, so the only thing that can suppress the
    // release click is the synthetic marker itself.
    await new Promise((resolve) => setTimeout(resolve, 5));

    seen[0]!.release();
    expect(seen).toHaveLength(1);

    dispose();
  });

  it('keeps the page usable when the handler throws', () => {
    // Fail open: an exception in our code must never block the user's prompt.
    const { composer } = mountChatGpt();
    const dispose = chatgptAdapter.onSubmitIntent(() => {
      throw new Error('boom');
    });

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    expect(() => composer.dispatchEvent(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(false);
    dispose();
  });

  it('detaches every listener on dispose', () => {
    const { composer } = mountChatGpt();
    const seen: SubmitIntent[] = [];
    chatgptAdapter.onSubmitIntent((i) => seen.push(i))();

    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    document
      .querySelector<HTMLElement>('[data-testid="send-button"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(seen).toEqual([]);
  });
});

describe('onPaste', () => {
  function pasteEvent(text: string): ClipboardEvent {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    });
    return event as ClipboardEvent;
  }

  it('fires for a paste into the composer', () => {
    const { composer } = mountChatGpt();
    const seen: string[] = [];
    const dispose = chatgptAdapter.onPaste!((p) => seen.push(p.text));

    composer.dispatchEvent(pasteEvent('AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7'));

    expect(seen).toEqual(['AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7']);
    dispose();
  });

  it('ignores pastes elsewhere on the page', () => {
    mountChatGpt();
    const seen: string[] = [];
    const dispose = chatgptAdapter.onPaste!((p) => seen.push(p.text));

    document.body.dispatchEvent(pasteEvent('unrelated'));

    expect(seen).toEqual([]);
    dispose();
  });

  it('never cancels the paste', () => {
    // Nothing has left the machine by pasting into a textbox. Cancelling would
    // risk breaking paste entirely for no security gain.
    const { composer } = mountChatGpt();
    const dispose = chatgptAdapter.onPaste!(() => {});

    const event = pasteEvent('AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7');
    composer.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    dispose();
  });

  it('keeps paste working when the handler throws', () => {
    const { composer } = mountChatGpt();
    const dispose = chatgptAdapter.onPaste!(() => {
      throw new Error('boom');
    });

    const event = pasteEvent('text');
    expect(() => composer.dispatchEvent(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(false);
    dispose();
  });

  it('ignores an empty clipboard', () => {
    const { composer } = mountChatGpt();
    const seen: string[] = [];
    const dispose = chatgptAdapter.onPaste!((p) => seen.push(p.text));

    composer.dispatchEvent(pasteEvent(''));

    expect(seen).toEqual([]);
    dispose();
  });

  it('detaches on dispose', () => {
    const { composer } = mountChatGpt();
    const seen: string[] = [];
    chatgptAdapter.onPaste!((p) => seen.push(p.text))();

    composer.dispatchEvent(pasteEvent('text'));

    expect(seen).toEqual([]);
  });
});

describe('onInput', () => {
  it('fires for edits in the composer', () => {
    const { composer } = mountChatGpt();
    const onInput = vi.fn();
    const dispose = chatgptAdapter.onInput!(onInput);

    composer.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onInput).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('ignores input elsewhere on the page', () => {
    mountChatGpt();
    const onInput = vi.fn();
    const dispose = chatgptAdapter.onInput!(onInput);

    document.body.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onInput).not.toHaveBeenCalled();
    dispose();
  });

  it('keeps typing working when the handler throws', () => {
    const { composer } = mountChatGpt();
    const dispose = chatgptAdapter.onInput!(() => {
      throw new Error('boom');
    });

    expect(() =>
      composer.dispatchEvent(new Event('input', { bubbles: true })),
    ).not.toThrow();
    dispose();
  });

  it('detaches on dispose', () => {
    const { composer } = mountChatGpt();
    const onInput = vi.fn();
    chatgptAdapter.onInput!(onInput)();

    composer.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onInput).not.toHaveBeenCalled();
  });
});

/**
 * Conversation fixture mirroring the live DOM inspected on 2026-08-13.
 *
 * Reproduces two details that shaped the implementation: turns do NOT share a
 * direct parent (each sits in its own `data-turn-id-container`), and the role
 * lives on the turn as `data-turn` with an inner `data-message-author-role`
 * as backup.
 */
function mountConversation(): HTMLElement {
  document.body.innerHTML = `
    <main>
      <div class="thread">
        <div data-turn-id-container="t1">
          <div data-testid="conversation-turn-1" data-turn="user" data-turn-id="t1">
            <div data-message-author-role="user" data-message-id="t1">Hello there</div>
          </div>
        </div>
        <div data-turn-id-container="t2">
          <div data-testid="conversation-turn-2" data-turn="assistant" data-turn-id="t2">
            <div data-message-author-role="assistant" data-message-id="t2">
              <div class="markdown"><p>Hi, how can I help?</p></div>
            </div>
          </div>
        </div>
      </div>
    </main>
  `;
  return document.querySelector('main')!;
}

describe('getMessages', () => {
  it('reads every turn in order with its role', () => {
    mountConversation();
    const messages = chatgptAdapter.getMessages!();

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0]!.text).toContain('Hello there');
    expect(messages[1]!.text).toContain('how can I help');
  });

  it('exposes the host page’s stable message id', () => {
    mountConversation();
    expect(chatgptAdapter.getMessages!().map((m) => m.id)).toEqual(['t1', 't2']);
  });

  it('falls back to the inner author-role marker', () => {
    mountConversation();
    const turn = document.querySelector<HTMLElement>('[data-turn="assistant"]')!;
    turn.removeAttribute('data-turn');

    const messages = chatgptAdapter.getMessages!();
    expect(messages[1]!.role).toBe('assistant');
  });

  it('returns empty on a page with no conversation', () => {
    document.body.innerHTML = '<main></main>';
    expect(chatgptAdapter.getMessages!()).toEqual([]);
  });
});

describe('getConversationId', () => {
  const setPath = (pathname: string) => {
    window.history.replaceState({}, '', pathname);
  };

  it('reads the id from the URL', () => {
    setPath('/c/6a7a66c5-c798-83ea-9cec-19cfd202dcb5');
    expect(chatgptAdapter.getConversationId!()).toBe(
      '6a7a66c5-c798-83ea-9cec-19cfd202dcb5',
    );
  });

  it('returns null for a fresh chat that has no id yet', () => {
    // Inventing one would let two different new chats share vault entries.
    setPath('/');
    expect(chatgptAdapter.getConversationId!()).toBeNull();
  });

  it('returns null for an unrelated path', () => {
    setPath('/gpts');
    expect(chatgptAdapter.getConversationId!()).toBeNull();
  });
});

describe('observeResponse', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('reports an assistant turn when its text changes', async () => {
    mountConversation();
    const seen: string[] = [];
    const dispose = chatgptAdapter.observeResponse!((node) =>
      seen.push(node.getAttribute('data-turn-id') ?? ''),
    );

    const markdown = document.querySelector<HTMLElement>('.markdown p')!;
    markdown.textContent = 'Updated answer';
    await settle();

    expect(seen).toContain('t2');
    dispose();
  });

  it('sees streamed text, which mutates existing nodes rather than adding them', async () => {
    // Without characterData in the observer config, a placeholder arriving
    // mid-stream would never be noticed.
    mountConversation();
    const seen: string[] = [];
    const dispose = chatgptAdapter.observeResponse!((node) =>
      seen.push(node.getAttribute('data-turn-id') ?? ''),
    );

    const textNode = document.querySelector('.markdown p')!.firstChild!;
    textNode.textContent = 'streamed token';
    await settle();

    expect(seen).toContain('t2');
    dispose();
  });

  it('reports a newly appended assistant turn', async () => {
    const main = mountConversation();
    const seen: string[] = [];
    const dispose = chatgptAdapter.observeResponse!((node) =>
      seen.push(node.getAttribute('data-turn-id') ?? ''),
    );

    const container = document.createElement('div');
    container.innerHTML = `
      <div data-testid="conversation-turn-3" data-turn="assistant" data-turn-id="t3">
        <div class="markdown"><p>New reply</p></div>
      </div>`;
    main.querySelector('.thread')!.appendChild(container);
    await settle();

    expect(seen).toContain('t3');
    dispose();
  });

  it('ignores user turns', async () => {
    // The user's own text is already theirs; rewriting it would change what
    // they can see they sent.
    mountConversation();
    const seen: string[] = [];
    const dispose = chatgptAdapter.observeResponse!((node) =>
      seen.push(node.getAttribute('data-turn-id') ?? ''),
    );

    document.querySelector<HTMLElement>('[data-turn="user"] div')!.textContent = 'edited';
    await settle();

    expect(seen).not.toContain('t1');
    dispose();
  });

  it('reports a turn once per batch however many nodes changed', async () => {
    mountConversation();
    const seen: string[] = [];
    const dispose = chatgptAdapter.observeResponse!((node) =>
      seen.push(node.getAttribute('data-turn-id') ?? ''),
    );

    const markdown = document.querySelector<HTMLElement>('.markdown')!;
    markdown.appendChild(document.createElement('p'));
    markdown.appendChild(document.createElement('p'));
    markdown.appendChild(document.createElement('p'));
    await settle();

    expect(seen.filter((id) => id === 't2')).toHaveLength(1);
    dispose();
  });

  it('keeps rendering the page when the callback throws', async () => {
    mountConversation();
    const dispose = chatgptAdapter.observeResponse!(() => {
      throw new Error('boom');
    });

    const markdown = document.querySelector<HTMLElement>('.markdown p')!;
    expect(() => {
      markdown.textContent = 'change';
    }).not.toThrow();
    await settle();

    dispose();
  });

  it('detaches on dispose', async () => {
    mountConversation();
    const seen: string[] = [];
    chatgptAdapter.observeResponse!((node) => seen.push(node.tagName))();

    document.querySelector<HTMLElement>('.markdown p')!.textContent = 'change';
    await settle();

    expect(seen).toEqual([]);
  });
});

describe('checkHealth', () => {
  it('reports a healthy composer and which strategy found it', () => {
    mountChatGpt();
    expect(chatgptAdapter.checkHealth()).toEqual({
      composerFound: true,
      submitListenersAttached: true,
      resolvedVia: 'id',
    });
  });

  it('reports failure rather than throwing when the page is unrecognisable', () => {
    document.body.innerHTML = '<main><p>nothing here</p></main>';
    expect(chatgptAdapter.checkHealth()).toEqual({
      composerFound: false,
      submitListenersAttached: false,
      resolvedVia: null,
    });
  });
});
