import { expect, it, vi } from 'vitest';
import type { SiteAdapter, SubmitIntent } from './types';

/**
 * Shared conformance suite for site adapters.
 *
 * The point of the adapter layer is that adding a platform should be an
 * afternoon of work, not a rewrite. That only holds if every adapter obeys the
 * same contract — otherwise each new platform quietly invents its own
 * behaviour and the consumers accumulate special cases.
 *
 * These tests are written against a DOM fixture supplied by each adapter, and
 * **that fixture must be built from an actual observation of the live page.**
 * Bug_0001 came from a fixture invented to suit the code rather than to
 * describe the page: it passed everything and hid a bug in the product's main
 * use case for five milestones. A fixture is a claim about the world, and an
 * unverified claim is worse than none — it produces confidence without cover.
 */

export interface ConformanceFixture {
  /** Builds the page's DOM. Returns the composer element. */
  mount: () => HTMLElement;
  /** Fills the composer as the real editor would, one block per line. */
  fillLines: (composer: HTMLElement, lines: string[]) => void;
  /** Triggers the platform's send control. */
  clickSend: () => void;
  /** Whether this platform exposes a form-submit path. */
  hasForm: boolean;
}

/**
 * Asserts an adapter meets the contract every consumer relies on.
 *
 * Called from each adapter's own test file, so a failure names the platform.
 */
export function runAdapterConformance(
  adapter: SiteAdapter,
  fixture: ConformanceFixture,
): void {
  it('declares an id and at least one host pattern', () => {
    expect(adapter.id).toBeTruthy();
    expect(adapter.hostPatterns.length).toBeGreaterThan(0);
  });

  it('finds the composer', () => {
    fixture.mount();
    expect(adapter.getComposer()).not.toBeNull();
  });

  it('returns null rather than throwing on an unrecognisable page', () => {
    // A missing composer is normal during navigation, not an error. The
    // extension must degrade to doing nothing, never to a broken chat.
    document.body.innerHTML = '<main><p>nothing here</p></main>';
    expect(() => adapter.getComposer()).not.toThrow();
    expect(adapter.getComposer()).toBeNull();
  });

  it('never selects a zero-size decoy element', () => {
    // Both ChatGPT and Claude ship an invisible textarea beside the real
    // composer. It is connected and unhidden, so naive checks accept it, and
    // writing into it does nothing the user can see.
    fixture.mount();
    const found = adapter.getComposer();
    const rect = found?.getBoundingClientRect();
    expect(rect?.width ?? 0).toBeGreaterThan(0);
  });

  it('reads text from the composer', () => {
    const composer = fixture.mount();
    fixture.fillLines(composer, ['hello there']);
    expect(adapter.getText(composer)).toBe('hello there');
  });

  it('reads an empty composer as an empty string', () => {
    const composer = fixture.mount();
    expect(adapter.getText(composer)).toBe('');
  });

  it('preserves line breaks when reading multi-line text', () => {
    // Bug_0001. Every platform in this suite uses a block-structured editor,
    // where textContent concatenates lines with no separator — gluing a secret
    // at the end of one line to the start of the next, so `\b`-anchored rules
    // stop matching and the secret is silently missed.
    const composer = fixture.mount();
    fixture.fillLines(composer, [
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      'DATABASE_URL=postgres://app:hunter2pass@db.internal:5432/orders',
    ]);

    const text = adapter.getText(composer);

    expect(text).toContain('\n');
    expect(/\bAKIA[0-9A-Z]{16}\b/.test(text)).toBe(true);
  });

  it('writes text and notifies the editor', () => {
    const composer = fixture.mount();
    const onInput = vi.fn();
    composer.addEventListener('input', onInput);

    adapter.setText(composer, 'AWS_KEY=[REDACTED_AWS_ACCESS_KEY_ID_1]');

    expect(adapter.getText(composer)).toContain('[REDACTED_');
    expect(onInput).toHaveBeenCalled();
  });

  it('fires a submit intent on Enter in the composer', () => {
    const composer = fixture.mount();
    const seen: SubmitIntent[] = [];
    const dispose = adapter.onSubmitIntent((i) => seen.push(i));

    composer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(seen.map((i) => i.trigger)).toEqual(['enter']);
    dispose();
  });

  it('ignores Shift+Enter, which inserts a newline', () => {
    const composer = fixture.mount();
    const seen: SubmitIntent[] = [];
    const dispose = adapter.onSubmitIntent((i) => seen.push(i));

    composer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
    );

    expect(seen).toEqual([]);
    dispose();
  });

  it('ignores Enter during IME composition', () => {
    // Committing a Japanese or Chinese candidate uses Enter. Treating that as
    // a submit would make the extension actively hostile to those users.
    const composer = fixture.mount();
    const seen: SubmitIntent[] = [];
    const dispose = adapter.onSubmitIntent((i) => seen.push(i));

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(event, 'isComposing', { value: true });
    composer.dispatchEvent(event);

    expect(seen).toEqual([]);
    dispose();
  });

  it('fires exactly once per send gesture', () => {
    // One user action must produce one approval prompt, however many DOM
    // events the platform emits for it.
    fixture.mount();
    const seen: SubmitIntent[] = [];
    const dispose = adapter.onSubmitIntent((i) => seen.push(i));

    fixture.clickSend();

    expect(seen).toHaveLength(1);
    dispose();
  });

  it('lets the handler cancel the submission', () => {
    const composer = fixture.mount();
    const dispose = adapter.onSubmitIntent((intent) => intent.event.preventDefault());

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    composer.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    dispose();
  });

  it('keeps the page working when the handler throws', () => {
    // Fail open: an exception in our code must never block the user's prompt.
    const composer = fixture.mount();
    const dispose = adapter.onSubmitIntent(() => {
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

  it('detaches every submit listener on dispose', () => {
    const composer = fixture.mount();
    const seen: SubmitIntent[] = [];
    adapter.onSubmitIntent((i) => seen.push(i))();

    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.clickSend();

    expect(seen).toEqual([]);
  });

  it('reports health, including which strategy resolved the composer', () => {
    fixture.mount();
    const health = adapter.checkHealth();

    expect(health.composerFound).toBe(true);
    expect(health.resolvedVia).toBeTruthy();
  });

  it('reports unhealthy rather than throwing on a broken page', () => {
    // Silent failure is the worst outcome for a security tool: the user
    // believes they are protected when they are not.
    document.body.innerHTML = '<main></main>';
    const health = adapter.checkHealth();

    expect(health.composerFound).toBe(false);
    expect(health.resolvedVia).toBeNull();
  });
}
