import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeAdapter } from './claude';
import { runAdapterConformance } from './conformance';
import type { SubmitIntent } from './types';

/**
 * Claude adapter tests.
 *
 * The fixture reproduces claude.ai as inspected on 2026-08-13, including the
 * details that would otherwise be invented:
 *
 *  - the composer is a Tiptap/ProseMirror contenteditable with
 *    `data-testid="chat-input"`
 *  - a 0×0 DISABLED `<textarea id="static-composer-input">` sits beside it
 *  - there is NO `<form>` — Claude's submit path is Enter and button only
 *  - there is NO `<main>` — the page uses `[role="main"]`
 *  - user turns carry `data-testid="user-message"`; assistant turns are
 *    identified only by the `font-claude-response` class
 */

function withLayout(el: Element, width = 620, height = 20): void {
  el.getBoundingClientRect = () => ({ width, height, right: width }) as DOMRect;
}

function mountClaude(): HTMLElement {
  document.body.innerHTML = `
    <div role="main">
      <div class="thread"></div>
      <div class="composer">
        <div data-testid="chat-input" contenteditable="true" role="textbox"
             class="tiptap ProseMirror" aria-multiline="true"
             aria-label="Write your prompt to Claude"></div>
        <textarea id="static-composer-input" disabled></textarea>
        <button aria-label="Add files, connectors, and more" type="button"></button>
        <button data-testid="model-selector-dropdown" type="button"></button>
        <button aria-label="Send message" type="button"></button>
      </div>
    </div>
  `;

  const composer = document.querySelector<HTMLElement>('[data-testid="chat-input"]')!;
  withLayout(composer);

  // The real page ships this at 0×0 — reproduce it faithfully.
  withLayout(document.querySelector('textarea')!, 0, 0);

  // Give the buttons increasing right edges so the rightmost-button fallback
  // has something meaningful to choose between. On the real page the send
  // control is the last one in the row.
  [...document.querySelectorAll('button')].forEach((button, index) => {
    button.getBoundingClientRect = () =>
      ({ width: 32, height: 32, right: 100 + index * 40 }) as DOMRect;
  });

  return composer;
}

function fillLines(composer: HTMLElement, lines: string[]): void {
  composer.innerHTML = '';
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    composer.appendChild(p);
  }
}

function clickSend(): void {
  document
    .querySelector<HTMLElement>('button[aria-label="Send message"]')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
});

describe('adapter conformance', () => {
  runAdapterConformance(claudeAdapter, {
    mount: mountClaude,
    fillLines,
    clickSend,
    hasForm: false,
  });
});

describe('composer resolution', () => {
  it('never selects the 0×0 disabled textarea', () => {
    // Claude ships this decoy exactly as ChatGPT does. It is connected and
    // unhidden, so naive checks accept it, and writing into it does nothing.
    mountClaude();
    const found = claudeAdapter.getComposer();

    expect(found?.tagName.toLowerCase()).not.toBe('textarea');
    expect(found?.getAttribute('data-testid')).toBe('chat-input');
  });

  it('falls back to the role when the testid changes', () => {
    const composer = mountClaude();
    composer.removeAttribute('data-testid');

    expect(claudeAdapter.getComposer()).toBe(composer);
    expect(claudeAdapter.checkHealth().resolvedVia).toBe('role-textbox');
  });

  it('falls back to the tiptap class when testid and role are gone', () => {
    const composer = mountClaude();
    composer.removeAttribute('data-testid');
    composer.removeAttribute('role');

    expect(claudeAdapter.getComposer()).toBe(composer);
    expect(claudeAdapter.checkHealth().resolvedVia).toBe('tiptap');
  });

  it('does not depend on the aria-label, which is locale-dependent', () => {
    // "Write your prompt to Claude" becomes something else in every other
    // language, so it must not appear in any strategy.
    const composer = mountClaude();
    composer.setAttribute('aria-label', 'Écrivez votre message à Claude');

    expect(claudeAdapter.getComposer()).toBe(composer);
  });
});

describe('submission', () => {
  it('fires once on a send click, with no form to double-fire', () => {
    mountClaude();
    const seen: SubmitIntent[] = [];
    const dispose = claudeAdapter.onSubmitIntent((i) => seen.push(i));

    clickSend();

    expect(seen.map((i) => i.trigger)).toEqual(['button']);
    dispose();
  });

  it('ignores clicks on other composer buttons', () => {
    mountClaude();
    const seen: SubmitIntent[] = [];
    const dispose = claudeAdapter.onSubmitIntent((i) => seen.push(i));

    document
      .querySelector<HTMLElement>('[data-testid="model-selector-dropdown"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(seen).toEqual([]);
    dispose();
  });

  it('does not re-intercept its own programmatic submit', async () => {
    // release() clicks the real send button; without the guard the extension
    // would intercept its own submission and loop.
    mountClaude();
    const seen: SubmitIntent[] = [];
    const dispose = claudeAdapter.onSubmitIntent((i) => seen.push(i));

    clickSend();
    expect(seen).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 5));
    seen[0]!.release();

    expect(seen).toHaveLength(1);
    dispose();
  });
});

describe('conversation reading', () => {
  function mountThread(): void {
    mountClaude();
    document.querySelector('.thread')!.innerHTML = `
      <div class="font-claude-response"><p>An assistant reply</p></div>
      <div data-testid="user-message"><p>A user message</p></div>
      <div class="font-claude-response"><p>Another reply</p></div>
    `;
  }

  it('reads turns in order with the right roles', () => {
    mountThread();
    expect(claudeAdapter.getMessages!().map((m) => m.role)).toEqual([
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('reports a null id, because Claude exposes none', () => {
    // Verified against a real thread: no turn carries a stable per-message
    // identifier. Synthesising an index would look stable and silently change
    // when a message is edited or a branch switched.
    mountThread();
    expect(claudeAdapter.getMessages!().every((m) => m.id === null)).toBe(true);
  });

  it('returns empty on a page with no conversation', () => {
    mountClaude();
    expect(claudeAdapter.getMessages!()).toEqual([]);
  });
});

describe('conversation id', () => {
  const setPath = (pathname: string) => window.history.replaceState({}, '', pathname);

  it('reads the id from a chat URL', () => {
    setPath('/chat/2bc65e8c-90b8-4750-8cf5-8ae7844e9d35');
    expect(claudeAdapter.getConversationId!()).toBe(
      '2bc65e8c-90b8-4750-8cf5-8ae7844e9d35',
    );
  });

  it('returns null for a new, unsent chat', () => {
    // Inventing an id would let two different new conversations share vault
    // entries, which is the cross-conversation bleed the scoping prevents.
    setPath('/new');
    expect(claudeAdapter.getConversationId!()).toBeNull();
  });

  it('returns null for the recents list', () => {
    setPath('/recents');
    expect(claudeAdapter.getConversationId!()).toBeNull();
  });
});

describe('response observation', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  function mountThread(): void {
    mountClaude();
    document.querySelector('.thread')!.innerHTML =
      '<div class="font-claude-response"><p>reply</p></div>';
  }

  it('observes without a <main> element, which Claude does not have', async () => {
    mountThread();
    const seen: string[] = [];
    const dispose = claudeAdapter.observeResponse!((n) => seen.push(n.className));

    document.querySelector<HTMLElement>('.font-claude-response p')!.textContent =
      'streamed';
    await settle();

    expect(seen.length).toBeGreaterThan(0);
    dispose();
  });

  it('reports a newly appended assistant turn', async () => {
    mountThread();
    const seen: string[] = [];
    const dispose = claudeAdapter.observeResponse!((n) => seen.push(n.className));

    const added = document.createElement('div');
    added.innerHTML = '<div class="font-claude-response"><p>new</p></div>';
    document.querySelector('.thread')!.appendChild(added);
    await settle();

    expect(seen.length).toBeGreaterThan(0);
    dispose();
  });

  it('ignores user turns', async () => {
    mountClaude();
    document.querySelector('.thread')!.innerHTML =
      '<div data-testid="user-message"><p>mine</p></div>';

    const seen: string[] = [];
    const dispose = claudeAdapter.observeResponse!((n) => seen.push(n.className));

    document.querySelector<HTMLElement>('[data-testid="user-message"] p')!.textContent =
      'edited';
    await settle();

    expect(seen).toEqual([]);
    dispose();
  });

  it('detaches on dispose', async () => {
    mountThread();
    const seen: string[] = [];
    claudeAdapter.observeResponse!((n) => seen.push(n.className))();

    document.querySelector<HTMLElement>('.font-claude-response p')!.textContent = 'x';
    await settle();

    expect(seen).toEqual([]);
  });
});

describe('paste and input', () => {
  function pasteEvent(text: string): ClipboardEvent {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (t: string) => (t === 'text/plain' ? text : '') },
    });
    return event as ClipboardEvent;
  }

  it('reports a paste into the composer without cancelling it', () => {
    const composer = mountClaude();
    const seen: string[] = [];
    const dispose = claudeAdapter.onPaste!((p) => seen.push(p.text));

    const event = pasteEvent('AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7');
    composer.dispatchEvent(event);

    expect(seen).toHaveLength(1);
    expect(event.defaultPrevented).toBe(false);
    dispose();
  });

  it('reports input in the composer', () => {
    const composer = mountClaude();
    const onInput = vi.fn();
    const dispose = claudeAdapter.onInput!(onInput);

    composer.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onInput).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('ignores paste and input elsewhere on the page', () => {
    mountClaude();
    const seen: string[] = [];
    const onInput = vi.fn();
    const d1 = claudeAdapter.onPaste!((p) => seen.push(p.text));
    const d2 = claudeAdapter.onInput!(onInput);

    document.body.dispatchEvent(pasteEvent('elsewhere'));
    document.body.dispatchEvent(new Event('input', { bubbles: true }));

    expect(seen).toEqual([]);
    expect(onInput).not.toHaveBeenCalled();
    d1();
    d2();
  });
});
