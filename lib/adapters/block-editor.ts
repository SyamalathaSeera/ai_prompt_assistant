/**
 * Shared handling for block-structured rich-text composers.
 *
 * Every platform this extension supports builds its composer on an editor that
 * renders each line as its own block element — verified live on 2026-08-13:
 *
 *   ChatGPT   ProseMirror
 *   Claude    Tiptap (ProseMirror)
 *   Gemini    Quill
 *
 * Two different editor libraries, one identical trap. This module was
 * originally written as `prosemirror.ts` and renamed once Gemini's Quill
 * composer was found to behave the same way: the problem belongs to the
 * *shape* of the DOM, not to any particular library.
 *
 * It exists because of Bug_0001 — multi-line prompts read with their line
 * breaks erased, silently missing secrets. Found in the ChatGPT adapter, then
 * confirmed reproducible in both Claude and Gemini. Fixing it per-adapter
 * would have meant shipping the same defect three times.
 */

/**
 * Elements that represent a line of their own.
 *
 * `<p>` is the ordinary case in all three editors; the rest cover code blocks,
 * quotes, and list items, which a pasted config or snippet can produce.
 */
const BLOCK_TAGS = new Set(['p', 'div', 'pre', 'blockquote', 'li', 'h1', 'h2', 'h3']);

/**
 * Reads a ProseMirror composer's text, preserving line breaks.
 *
 * ProseMirror renders each line as its own block element, and `textContent`
 * concatenates block elements with NO separator — so a pasted `.env` file
 * comes back as `...EXAMPLEDATABASE_URL=...`, with every line boundary erased.
 *
 * That is not cosmetic. Most detection rules are anchored with `\b`, so a
 * secret at the end of a line gets glued to the start of the next one and
 * stops matching entirely. Pasting a multi-line config is the single most
 * common way this product is used.
 */
export function readBlockEditorText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement) return el.value;

  const blocks = [...el.children].filter((child) =>
    BLOCK_TAGS.has(child.tagName.toLowerCase()),
  );

  // No block children: a plain contenteditable, where textContent is correct.
  if (blocks.length === 0) return el.textContent ?? '';

  return blocks.map((block) => block.textContent ?? '').join('\n');
}

/**
 * Replaces a ProseMirror composer's content.
 *
 * Routes through `execCommand('insertText')`, which uses the browser's native
 * editing pipeline — ProseMirror handles it exactly as it handles a real user
 * edit, so its internal document cannot drift from the DOM.
 *
 * That distinction is the difference between a redaction that works and one
 * that appears to. If the editor's document were stale at submit time, the
 * host would send the ORIGINAL text while the user believed it had been
 * redacted. Verified working on the live ChatGPT page 2026-08-13, including
 * that the editor's own document matched afterwards.
 *
 * The assignment path is kept only as a fallback for environments without
 * execCommand.
 */
export function writeBlockEditorText(el: HTMLElement, text: string): void {
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
}
