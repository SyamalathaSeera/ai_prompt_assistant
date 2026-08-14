import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  byEditableNearSubmit,
  byFocusedEditable,
  HEURISTIC_COMPOSER_STRATEGIES,
} from './heuristic';
import { resolveWithFallback } from './resolve';
import { chatgptAdapter } from './chatgpt';

/**
 * Last-resort composer discovery.
 *
 * With milestone 0.5.0.0 Task 2 deferred there is no remote selector feed
 * coming to fix a host DOM change, so these two strategies are the entire
 * recovery story. They matter more than their size suggests.
 */

let root: HTMLElement;

/** jsdom measures everything as 0×0; size has to be declared explicitly. */
function giveSize(el: Element, width: number, height: number) {
  el.getBoundingClientRect = () => ({ width, height, top: 0, left: 0 }) as DOMRect;
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  root.remove();
});

describe('finding the editable the user is typing in', () => {
  it('takes focus as the strongest available signal', () => {
    root.innerHTML = `
      <textarea id="search"></textarea>
      <div id="composer" contenteditable="true" role="textbox"></div>
    `;
    const composer = root.querySelector<HTMLElement>('#composer')!;
    composer.focus();

    expect(byFocusedEditable().find(document)).toBe(composer);
  });

  it('ignores focus that is not on an editable', () => {
    root.innerHTML = `<button id="send">Send</button><textarea></textarea>`;
    root.querySelector<HTMLElement>('#send')!.focus();

    expect(byFocusedEditable().find(document)).toBeNull();
  });

  it('refuses a disabled or read-only editable', () => {
    root.innerHTML = `<textarea id="ro" readonly></textarea>`;
    const readOnly = root.querySelector<HTMLTextAreaElement>('#ro')!;
    readOnly.focus();

    expect(byFocusedEditable().find(document)).toBeNull();
  });

  it('never returns our own injected UI', () => {
    /*
     * The composer is where the user's prompt goes. Handing back our own
     * textarea — the refinement editor, say — would write their prompt into
     * our panel and lose it.
     */
    root.innerHTML = `<div data-testid="apa-refine-review"><textarea id="ours"></textarea></div>`;
    root.querySelector<HTMLTextAreaElement>('#ours')!.focus();

    expect(byFocusedEditable().find(document)).toBeNull();
  });
});

describe('finding the editable nearest a send control', () => {
  it('prefers the editable closest to a submit button in the DOM', () => {
    root.innerHTML = `
      <div><textarea id="far"></textarea></div>
      <form>
        <div><div id="near" contenteditable="true"></div></div>
        <button type="submit">Send</button>
      </form>
    `;

    expect(byEditableNearSubmit().find(root)?.id).toBe('near');
  });

  it('breaks a tie on size, which is the real ChatGPT case', () => {
    /*
     * chatgpt.com ships a 0×0 <textarea name="prompt-textarea"> as a sibling
     * of the real ProseMirror composer. Both are equidistant from the send
     * button, and picking the decoy would silently swallow every write.
     */
    root.innerHTML = `
      <form>
        <textarea id="decoy"></textarea>
        <div id="real" contenteditable="true"></div>
        <button type="submit">Send</button>
      </form>
    `;
    giveSize(root.querySelector('#decoy')!, 0, 0);
    giveSize(root.querySelector('#real')!, 700, 60);

    expect(byEditableNearSubmit().find(root)?.id).toBe('real');
  });

  it('falls back to the largest editable when nothing looks like a send control', () => {
    root.innerHTML = `
      <textarea id="small"></textarea>
      <div id="big" contenteditable="true"></div>
    `;
    giveSize(root.querySelector('#small')!, 100, 20);
    giveSize(root.querySelector('#big')!, 700, 60);

    expect(byEditableNearSubmit().find(root)?.id).toBe('big');
  });

  it.each([
    ['plaintext-only', '<div id="c" contenteditable="plaintext-only"></div>'],
    ['an empty attribute', '<div id="c" contenteditable></div>'],
    ['role alone', '<div id="c" role="textbox"></div>'],
  ])('treats %s as editable', (_label, markup) => {
    /*
     * A gap the end-to-end suite found. This originally asked for
     * `contenteditable="true"` exactly, and the unit fixture happened to keep
     * `role="textbox"` as a second way in — so it passed while the real
     * recovery path found nothing on a page that had dropped both.
     *
     * `plaintext-only` is a real, supported value and exactly what a chat
     * composer would sensibly use.
     */
    root.innerHTML = `<form>${markup}<button type="submit">Send</button></form>`;

    expect(byEditableNearSubmit().find(root)?.id).toBe('c');
  });

  it('still refuses contenteditable="false"', () => {
    root.innerHTML = `
      <form>
        <div id="c" contenteditable="false"></div>
        <button type="submit">Send</button>
      </form>
    `;

    expect(byEditableNearSubmit().find(root)).toBeNull();
  });

  it('returns null when there is nothing editable at all', () => {
    root.innerHTML = `<form><button type="submit">Send</button></form>`;

    expect(byEditableNearSubmit().find(root)).toBeNull();
  });

  it('ignores a detached editable', () => {
    root.innerHTML = `<form><button type="submit">Send</button></form>`;
    const orphan = document.createElement('textarea');
    // Never appended: querySelector cannot see it, and isUsable would reject it.

    expect(byEditableNearSubmit().find(root)).toBeNull();
    expect(orphan.isConnected).toBe(false);
  });
});

describe('the chain as a whole', () => {
  /**
   * A breakage that defeats every ChatGPT-specific strategy.
   *
   * `contenteditable="plaintext-only"` is a real attribute value and a
   * plausible thing for ChatGPT to ship. It slips past every selector in that
   * adapter, all of which ask for `contenteditable="true"` exactly — including
   * the generic `largest-editable` tail. That is what makes it a fair test:
   * an earlier draft used an unrecognised class name and passed, but only
   * because `largest-editable` caught it, so the heuristics were never
   * reached and the test proved nothing.
   */
  const BROKEN_PAGE = `
    <form>
      <div id="composer" role="textbox" contenteditable="plaintext-only"></div>
      <button type="submit">Send</button>
    </form>
  `;

  it('recovers when every named selector fails', () => {
    root.innerHTML = BROKEN_PAGE;
    const composer = root.querySelector<HTMLElement>('#composer')!;
    giveSize(composer, 700, 60);

    expect(chatgptAdapter.getComposer()).toBe(composer);
  });

  it('reports which strategy saved it, so the failure is diagnosable', () => {
    root.innerHTML = BROKEN_PAGE;
    giveSize(root.querySelector('#composer')!, 700, 60);

    const health = chatgptAdapter.checkHealth();

    expect(health.composerFound).toBe(true);
    // "Working" and "working as designed" are different facts, and the health
    // layer needs to be able to tell them apart.
    expect(HEURISTIC_COMPOSER_STRATEGIES.map((s) => s.name)).toContain(
      health.resolvedVia,
    );
  });

  it('still prefers a named selector when one works', () => {
    // The heuristics are a safety net, not a shortcut. Firing while a precise
    // selector would have worked is a silent loss of precision.
    root.innerHTML = `
      <form>
        <div id="prompt-textarea" contenteditable="true"></div>
        <button type="submit">Send</button>
      </form>
    `;

    expect(chatgptAdapter.checkHealth().resolvedVia).toBe('id');
  });

  it('reports nothing found when the page has no composer', () => {
    root.innerHTML = `<div>An error page, or a route with no chat on it.</div>`;

    const resolution = resolveWithFallback(root, HEURISTIC_COMPOSER_STRATEGIES);

    expect(resolution.element).toBeNull();
    expect(resolution.resolvedVia).toBeNull();
  });
});
