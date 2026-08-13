import { beforeEach, describe, expect, it, vi } from 'vitest';
import { geminiAdapter } from './gemini';
import { runAdapterConformance } from './conformance';
import type { SubmitIntent } from './types';

/**
 * Gemini adapter tests.
 *
 * The fixture reproduces gemini.google.com as inspected on 2026-08-13:
 *
 *  - the composer is **Quill** (`.ql-editor`), not ProseMirror
 *  - `.ql-clipboard` is a 0×1 contenteditable Quill uses for paste handling —
 *    a third variant of the decoy element seen on ChatGPT and Claude
 *  - there is NO `<form>`
 *  - Angular attributes carry build hashes and are useless as selectors
 */

function withRect(el: Element, width: number, height: number, right = width): void {
  el.getBoundingClientRect = () => ({ width, height, right }) as DOMRect;
}

function mountGemini(): HTMLElement {
  document.body.innerHTML = `
    <main>
      <chat-window>
        <div class="thread"></div>
        <div class="input-area">
          <div class="ql-editor textarea new-input-ui" contenteditable="true"
               role="textbox" aria-multiline="true"
               aria-label="Enter a prompt for Gemini" data-placeholder="Ask Gemini"></div>
          <div class="ql-clipboard" contenteditable="true" tabindex="-1"></div>
          <button aria-label="Add files" mat-icon-button></button>
          <button aria-label="Send message" mat-icon-button></button>
        </div>
      </chat-window>
    </main>
  `;

  const composer = document.querySelector<HTMLElement>('.ql-editor')!;
  withRect(composer, 580, 24);

  // Quill's hidden paste buffer, at 0×1 on the real page.
  withRect(document.querySelector('.ql-clipboard')!, 0, 1);

  const buttons = [...document.querySelectorAll('button')];
  buttons.forEach((button, index) => withRect(button, 40, 40, 100 + index * 50));

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
});

describe('adapter conformance', () => {
  runAdapterConformance(geminiAdapter, {
    mount: mountGemini,
    fillLines,
    clickSend,
    hasForm: false,
  });
});

describe('composer resolution', () => {
  it('never selects Quill’s hidden clipboard element', () => {
    // .ql-clipboard is contenteditable and connected, so naive checks accept
    // it. Writing into it would silently do nothing — the same trap ChatGPT
    // and Claude set with their 0-size textareas.
    mountGemini();
    const found = geminiAdapter.getComposer();

    expect(found?.classList.contains('ql-clipboard')).toBe(false);
    expect(found?.classList.contains('ql-editor')).toBe(true);
  });

  it('falls back to the role when the Quill class changes', () => {
    const composer = mountGemini();
    composer.classList.remove('ql-editor');

    expect(geminiAdapter.getComposer()).toBe(composer);
    expect(geminiAdapter.checkHealth().resolvedVia).toBe('role-textbox');
  });

  it('falls back to the placeholder attribute', () => {
    const composer = mountGemini();
    composer.classList.remove('ql-editor');
    composer.removeAttribute('role');

    expect(geminiAdapter.getComposer()).toBe(composer);
    expect(geminiAdapter.checkHealth().resolvedVia).toBe('placeholder');
  });

  it('does not depend on the aria-label, which is locale-dependent', () => {
    const composer = mountGemini();
    composer.setAttribute('aria-label', 'Saisissez une requête pour Gemini');

    expect(geminiAdapter.getComposer()).toBe(composer);
  });
});

describe('reading text', () => {
  it('preserves line breaks across Quill blocks', () => {
    // Quill is a different editor library from ProseMirror and has exactly the
    // same trap: textContent joins block elements with no separator.
    const composer = mountGemini();
    fillLines(composer, [
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      'DATABASE_URL=postgres://app:hunter2pass@db.internal:5432/orders',
    ]);

    const text = geminiAdapter.getText(composer);

    expect(text).toContain('\n');
    expect(/\bAKIA[0-9A-Z]{16}\b/.test(text)).toBe(true);
  });
});

describe('submission', () => {
  it('fires once on a send click', () => {
    mountGemini();
    const seen: SubmitIntent[] = [];
    const dispose = geminiAdapter.onSubmitIntent((i) => seen.push(i));

    clickSend();

    expect(seen.map((i) => i.trigger)).toEqual(['button']);
    dispose();
  });

  it('ignores other composer buttons', () => {
    mountGemini();
    const seen: SubmitIntent[] = [];
    const dispose = geminiAdapter.onSubmitIntent((i) => seen.push(i));

    document
      .querySelector<HTMLElement>('button[aria-label="Add files"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(seen).toEqual([]);
    dispose();
  });

  it('does not re-intercept its own programmatic submit', async () => {
    mountGemini();
    const seen: SubmitIntent[] = [];
    const dispose = geminiAdapter.onSubmitIntent((i) => seen.push(i));

    clickSend();
    expect(seen).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 5));
    seen[0]!.release();

    expect(seen).toHaveLength(1);
    dispose();
  });
});

describe('declared capabilities', () => {
  it('declines message reading rather than guessing at it', () => {
    // Gemini's conversation DOM could not be verified — the account inspected
    // had no history. An adapter that looks complete and silently fails is
    // exactly the Bug_0001 failure, so the capability is omitted instead.
    expect(geminiAdapter.getMessages).toBeUndefined();
    expect(geminiAdapter.observeResponse).toBeUndefined();
  });

  it('still supports everything redaction needs', () => {
    // The consequence of declining is bounded: secrets are still detected,
    // held, and redacted on Gemini. Only re-hydration is absent.
    expect(typeof geminiAdapter.getComposer).toBe('function');
    expect(typeof geminiAdapter.getText).toBe('function');
    expect(typeof geminiAdapter.setText).toBe('function');
    expect(typeof geminiAdapter.onSubmitIntent).toBe('function');
    expect(typeof geminiAdapter.onPaste).toBe('function');
    expect(typeof geminiAdapter.onInput).toBe('function');
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

  it('reports a paste without cancelling it', () => {
    const composer = mountGemini();
    const seen: string[] = [];
    const dispose = geminiAdapter.onPaste!((p) => seen.push(p.text));

    const event = pasteEvent('AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7');
    composer.dispatchEvent(event);

    expect(seen).toHaveLength(1);
    expect(event.defaultPrevented).toBe(false);
    dispose();
  });

  it('reports input in the composer', () => {
    const composer = mountGemini();
    const onInput = vi.fn();
    const dispose = geminiAdapter.onInput!(onInput);

    composer.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onInput).toHaveBeenCalledTimes(1);
    dispose();
  });
});
