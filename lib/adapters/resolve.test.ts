import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byLargest, bySelector, isUsable, resolveWithFallback } from './resolve';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('resolveWithFallback', () => {
  it('returns the first strategy that finds a usable element', () => {
    const root = mount('<textarea id="composer"></textarea>');

    const result = resolveWithFallback(root, [
      bySelector('aria', '[aria-label="Message"]'),
      bySelector('textarea', 'textarea'),
    ]);

    expect(result.element?.id).toBe('composer');
    expect(result.resolvedVia).toBe('textarea');
    expect(result.attempted).toEqual(['aria', 'textarea']);
  });

  it('stops at the first success without trying later strategies', () => {
    const root = mount('<textarea></textarea>');
    const later = vi.fn(() => null);

    const result = resolveWithFallback(root, [
      bySelector('textarea', 'textarea'),
      { name: 'never-run', find: later },
    ]);

    expect(result.resolvedVia).toBe('textarea');
    expect(later).not.toHaveBeenCalled();
  });

  it('reports null rather than throwing when nothing matches', () => {
    const root = mount('<div>no composer here</div>');

    const result = resolveWithFallback(root, [bySelector('textarea', 'textarea')]);

    expect(result.element).toBeNull();
    expect(result.resolvedVia).toBeNull();
    expect(result.attempted).toEqual(['textarea']);
  });

  it('continues past a strategy that throws', () => {
    // One broken strategy must never take down the ones after it.
    const root = mount('<textarea id="composer"></textarea>');

    const result = resolveWithFallback(root, [
      {
        name: 'explodes',
        find: () => {
          throw new Error('invalid selector');
        },
      },
      bySelector('textarea', 'textarea'),
    ]);

    expect(result.element?.id).toBe('composer');
    expect(result.resolvedVia).toBe('textarea');
  });

  it('skips a hidden element and falls through', () => {
    const root = mount(
      '<textarea id="stale" hidden></textarea><div contenteditable="true" id="live"></div>',
    );

    const result = resolveWithFallback(root, [
      bySelector('textarea', 'textarea'),
      bySelector('contenteditable', '[contenteditable="true"]'),
    ]);

    expect(result.element?.id).toBe('live');
    expect(result.resolvedVia).toBe('contenteditable');
  });

  it('skips an aria-hidden element', () => {
    const root = mount(
      '<textarea id="stale" aria-hidden="true"></textarea><textarea id="live"></textarea>',
    );

    const result = resolveWithFallback(root, [
      {
        name: 'first-textarea',
        find: (r) => r.querySelector<HTMLElement>('#stale'),
      },
      bySelector('any-textarea', '#live'),
    ]);

    expect(result.element?.id).toBe('live');
  });

  it('returns null for an empty strategy list', () => {
    const result = resolveWithFallback(mount('<textarea></textarea>'), []);
    expect(result.element).toBeNull();
    expect(result.attempted).toEqual([]);
  });
});

describe('isUsable', () => {
  it('rejects a detached element', () => {
    const orphan = document.createElement('textarea');
    expect(isUsable(orphan)).toBe(false);
  });

  it('accepts an attached, visible element', () => {
    const root = mount('<textarea id="composer"></textarea>');
    expect(isUsable(root.querySelector('#composer')!)).toBe(true);
  });
});

describe('byLargest', () => {
  it('picks the largest candidate when several match', () => {
    // Pages often keep an offscreen or collapsed duplicate composer around;
    // the one the user is typing into is invariably the biggest.
    const root = mount(
      '<div contenteditable="true" id="small"></div><div contenteditable="true" id="big"></div>',
    );

    const rects: Record<string, number> = { small: 10, big: 500 };
    for (const el of root.querySelectorAll<HTMLElement>('[contenteditable]')) {
      const size = rects[el.id] ?? 0;
      el.getBoundingClientRect = () =>
        ({ width: size, height: size }) as DOMRect;
    }

    const result = resolveWithFallback(root, [
      byLargest('largest-editable', '[contenteditable="true"]'),
    ]);

    expect(result.element?.id).toBe('big');
  });

  it('returns null when nothing matches', () => {
    const result = resolveWithFallback(mount('<div></div>'), [
      byLargest('largest-editable', '[contenteditable="true"]'),
    ]);
    expect(result.element).toBeNull();
  });
});
