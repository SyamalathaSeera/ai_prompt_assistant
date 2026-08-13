import { beforeEach, describe, expect, it } from 'vitest';
import {
  dehydrate,
  findPlaceholders,
  hydrate,
  HYDRATED_ATTR,
  needsHydration,
  PLACEHOLDER_ATTR,
} from './index';

const KEY = 'AKIA3TZ2MRSYNTHETIC7';
const PLACEHOLDER = '[REDACTED_AWS_ACCESS_KEY_ID_1]';

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="turn">${html}</div>`;
  return document.getElementById('turn')!;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('finding placeholders', () => {
  it('finds a bracketed placeholder', () => {
    const root = mount(`<p>Your key ${PLACEHOLDER} looks valid.</p>`);
    expect(findPlaceholders(root)).toEqual([PLACEHOLDER]);
  });

  it('finds the dummy style too', () => {
    const root = mount('<p>Use dummy_aws_access_key_id_1 here.</p>');
    expect(findPlaceholders(root)).toEqual(['dummy_aws_access_key_id_1']);
  });

  it('finds several distinct placeholders', () => {
    const root = mount(
      '<p>[REDACTED_A_1] then [REDACTED_B_1] then [REDACTED_A_1]</p>',
    );
    expect(findPlaceholders(root).sort()).toEqual(['[REDACTED_A_1]', '[REDACTED_B_1]']);
  });

  it('finds nothing in ordinary prose', () => {
    const root = mount('<p>Nothing sensitive in this reply at all.</p>');
    expect(findPlaceholders(root)).toEqual([]);
    expect(needsHydration(root)).toBe(false);
  });
});

describe('hydrating', () => {
  it('shows the real value where the placeholder was', () => {
    const root = mount(`<p>Your key ${PLACEHOLDER} looks valid.</p>`);

    const result = hydrate(root, { [PLACEHOLDER]: KEY });

    expect(result.replaced).toBe(1);
    expect(root.textContent).toContain(KEY);
    expect(root.textContent).not.toContain(PLACEHOLDER);
  });

  it('keeps the surrounding text intact', () => {
    const root = mount(`<p>Your key ${PLACEHOLDER} looks valid.</p>`);
    hydrate(root, { [PLACEHOLDER]: KEY });

    expect(root.textContent).toBe(`Your key ${KEY} looks valid.`);
  });

  it('replaces every occurrence', () => {
    const root = mount(`<p>${PLACEHOLDER} and again ${PLACEHOLDER}</p>`);

    const result = hydrate(root, { [PLACEHOLDER]: KEY });

    expect(result.replaced).toBe(2);
    expect(root.querySelectorAll(`[${HYDRATED_ATTR}]`)).toHaveLength(2);
  });

  it('handles several different placeholders at once', () => {
    const root = mount('<p>[REDACTED_A_1] and [REDACTED_B_1]</p>');

    hydrate(root, { '[REDACTED_A_1]': 'first', '[REDACTED_B_1]': 'second' });

    expect(root.textContent).toBe('first and second');
  });

  it('reaches placeholders nested in markdown structure', () => {
    const root = mount(
      `<div class="markdown"><ol><li><code>${PLACEHOLDER}</code></li></ol></div>`,
    );

    hydrate(root, { [PLACEHOLDER]: KEY });

    expect(root.querySelector('code')!.textContent).toBe(KEY);
  });
});

describe('the substitution is visibly ours', () => {
  it('marks the element so it cannot be mistaken for model output', () => {
    // Silently rewriting a model's response would be a worse dishonesty than
    // the inconvenience it solves.
    const root = mount(`<p>${PLACEHOLDER}</p>`);
    hydrate(root, { [PLACEHOLDER]: KEY });

    const span = root.querySelector<HTMLElement>(`[${HYDRATED_ATTR}]`)!;
    expect(span).not.toBeNull();
    expect(span.style.borderBottom).toContain('dashed');
  });

  it('records the placeholder that was actually transmitted', () => {
    const root = mount(`<p>${PLACEHOLDER}</p>`);
    hydrate(root, { [PLACEHOLDER]: KEY });

    const span = root.querySelector<HTMLElement>(`[${HYDRATED_ATTR}]`)!;
    expect(span.getAttribute(PLACEHOLDER_ATTR)).toBe(PLACEHOLDER);
    expect(span.title).toContain(PLACEHOLDER);
    expect(span.title).toContain('Restored locally');
  });

  it('styles inline rather than injecting a stylesheet into the host page', () => {
    // These elements live in ChatGPT's document, outside our shadow root. A
    // stylesheet would mean leaking CSS into the page we promised not to touch.
    const before = document.querySelectorAll('style, link[rel="stylesheet"]').length;
    const root = mount(`<p>${PLACEHOLDER}</p>`);
    hydrate(root, { [PLACEHOLDER]: KEY });

    expect(document.querySelectorAll('style, link[rel="stylesheet"]')).toHaveLength(
      before,
    );
  });
});

describe('vault misses', () => {
  it('leaves an unknown placeholder exactly as sent', () => {
    // The placeholder IS what the model received, so leaving it keeps the page
    // truthful rather than blank or broken.
    const root = mount(`<p>Your key ${PLACEHOLDER} looks valid.</p>`);

    const result = hydrate(root, {});

    expect(result.replaced).toBe(0);
    expect(result.missed).toEqual([PLACEHOLDER]);
    expect(root.textContent).toContain(PLACEHOLDER);
  });

  it('hydrates what it can and reports the rest', () => {
    const root = mount('<p>[REDACTED_A_1] and [REDACTED_B_1]</p>');

    const result = hydrate(root, { '[REDACTED_A_1]': 'known' });

    expect(result.replaced).toBe(1);
    expect(result.missed).toEqual(['[REDACTED_B_1]']);
    expect(root.textContent).toBe('known and [REDACTED_B_1]');
  });

  it('does not throw on an empty subtree', () => {
    const root = mount('');
    expect(() => hydrate(root, {})).not.toThrow();
  });
});

describe('idempotence', () => {
  it('does nothing on a second pass', () => {
    // This is what stops the MutationObserver that triggers hydration from
    // looping on the mutations hydration itself causes.
    const root = mount(`<p>${PLACEHOLDER}</p>`);

    const first = hydrate(root, { [PLACEHOLDER]: KEY });
    const second = hydrate(root, { [PLACEHOLDER]: KEY });

    expect(first.replaced).toBe(1);
    expect(second.replaced).toBe(0);
    expect(root.querySelectorAll(`[${HYDRATED_ATTR}]`)).toHaveLength(1);
  });

  it('reports no further work after hydrating', () => {
    const root = mount(`<p>${PLACEHOLDER}</p>`);
    expect(needsHydration(root)).toBe(true);

    hydrate(root, { [PLACEHOLDER]: KEY });

    expect(needsHydration(root)).toBe(false);
  });

  it('ignores placeholders already inside a hydrated span', () => {
    const root = mount(`<p><span ${HYDRATED_ATTR}="true">${PLACEHOLDER}</span></p>`);
    expect(findPlaceholders(root)).toEqual([]);
  });
});

describe('display only', () => {
  it('never writes into an input the host page could send back', () => {
    // A restored value that could travel back to the model would undo the
    // entire redaction.
    const root = mount(
      `<p>${PLACEHOLDER}</p><input value="${PLACEHOLDER}"><textarea>${PLACEHOLDER}</textarea>`,
    );

    hydrate(root, { [PLACEHOLDER]: KEY });

    // The paragraph is display, so it gets the real value.
    expect(root.querySelector('p')!.textContent).toBe(KEY);

    // The form controls keep exactly what was transmitted. A textarea's inner
    // text IS its value, so rewriting it would hand the secret back.
    expect(root.querySelector('input')!.value).toBe(PLACEHOLDER);
    expect(root.querySelector('textarea')!.textContent).toBe(PLACEHOLDER);
    expect(root.querySelectorAll(`textarea [${HYDRATED_ATTR}]`)).toHaveLength(0);
  });

  it('never touches a contenteditable, which is the composer itself', () => {
    const root = mount(`<div contenteditable="true">${PLACEHOLDER}</div>`);

    hydrate(root, { [PLACEHOLDER]: KEY });

    expect(root.textContent).toBe(PLACEHOLDER);
  });

  it('touches nothing outside the subtree it was given', () => {
    document.body.innerHTML = `
      <div id="turn"><p>${PLACEHOLDER}</p></div>
      <div id="elsewhere"><p>${PLACEHOLDER}</p></div>`;

    hydrate(document.getElementById('turn')!, { [PLACEHOLDER]: KEY });

    expect(document.getElementById('elsewhere')!.textContent).toContain(PLACEHOLDER);
  });
});

describe('copying', () => {
  it('yields the real value when the text is selected and copied', () => {
    // Restoring the value is only useful if the user can then use it. Text
    // selection reads the DOM, so our span's content is what gets copied.
    const root = mount(`<pre><code>export AWS_KEY=${PLACEHOLDER}</code></pre>`);
    hydrate(root, { [PLACEHOLDER]: KEY });

    const code = root.querySelector('code')!;
    expect(code.textContent).toBe(`export AWS_KEY=${KEY}`);

    const range = document.createRange();
    range.selectNodeContents(code);
    expect(range.toString()).toContain(KEY);
  });
});

describe('dehydrate', () => {
  it('restores the transmitted placeholders', () => {
    const root = mount(`<p>Your key ${PLACEHOLDER} looks valid.</p>`);
    hydrate(root, { [PLACEHOLDER]: KEY });

    const restored = dehydrate(root);

    expect(restored).toBe(1);
    expect(root.textContent).toBe(`Your key ${PLACEHOLDER} looks valid.`);
    expect(root.querySelectorAll(`[${HYDRATED_ATTR}]`)).toHaveLength(0);
  });

  it('leaves untouched content alone', () => {
    const root = mount('<p>Nothing here was ever hydrated.</p>');
    expect(dehydrate(root)).toBe(0);
    expect(root.textContent).toBe('Nothing here was ever hydrated.');
  });

  it('round-trips exactly', () => {
    const root = mount(`<p>${PLACEHOLDER}</p>`);
    const original = root.innerHTML;

    hydrate(root, { [PLACEHOLDER]: KEY });
    dehydrate(root);

    expect(root.textContent).toBe(PLACEHOLDER);
    expect(root.innerHTML).toBe(original);
    expect(needsHydration(root)).toBe(true);
  });
});
