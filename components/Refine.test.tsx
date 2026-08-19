import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { Panel } from './Panel';
import { createPanelStore, type PanelStore } from './panel-store';
import { createRefineStore, type RefineStore } from './refine-store';
import { createRiskStore, type RiskStore } from './risk-store';
import { __resetForTests } from '@/lib/model/session';
import { STYLES } from '@/lib/refine';
import { detect } from '@/lib/detector/engine';
import { ALL_RULES } from '@/lib/detector/rules';

/**
 * The refinement surfaces, exercised through the Panel rather than in
 * isolation, because the properties that matter are about how they coexist:
 * the button must not collide with the risk badge, and only one thing at a
 * time may demand a decision.
 */

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';
const SUGGESTION = 'Fix the authentication bug in the login handler.';

/**
 * A draft the suggestion is plausibly a rewrite of.
 *
 * The quality gate refuses a rewrite that kept nothing of what the draft was
 * about, so the two sides of every pair here are about the same thing — as a
 * real pair would be.
 */
const ORIGINAL = 'fix the login bug quickly';

/**
 * Widest the button group can get: "Improving…" plus the caret, at the base
 * font size. Measured from the rendered control, since jsdom reports 0×0 for
 * everything and cannot be asked.
 */
const REFINE_GROUP_WIDTH = 130;

let container: HTMLElement;
let composer: HTMLElement;
let store: PanelStore;
let refineStore: RefineStore;
let riskStore: RiskStore;
let composerText: string;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const waitFor = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000 });
const left = (el: HTMLElement) => Number.parseFloat(el.style.left);

function installModel(reply: () => string | Promise<string>) {
  vi.stubGlobal('LanguageModel', {
    availability: async () => 'available',
    create: async () => ({ prompt: async () => reply(), destroy: () => {} }),
  });
}

/** jsdom reports 0×0 for everything; the anchor hook rejects zero-size rects. */
function giveLayout(el: HTMLElement, rect: Partial<DOMRect> = {}): void {
  el.getBoundingClientRect = () =>
    ({
      top: 500,
      left: 200,
      right: 900,
      bottom: 560,
      width: 700,
      height: 60,
      ...rect,
    }) as DOMRect;
}

function mount({
  available = true,
  draft = 'fix the bug',
  composerRect = {},
}: {
  available?: boolean;
  draft?: string;
  composerRect?: Partial<DOMRect>;
} = {}): void {
  composerText = draft;

  container = document.createElement('div');
  document.body.appendChild(container);

  composer = document.createElement('div');
  document.body.appendChild(composer);
  giveLayout(composer, composerRect);

  store = createPanelStore();
  riskStore = createRiskStore();
  refineStore = createRefineStore({
    getDraft: () => composerText,
    applyToComposer: (text) => {
      composerText = text;
    },
    rules: ALL_RULES,
  });

  render(
    <Panel
      store={store}
      riskStore={riskStore}
      refineStore={refineStore}
      getComposer={() => composer}
      refineAvailable={available}
    />,
    container,
  );
}

/** Runs a refinement the way the user would: by pressing the button. */
async function invoke(): Promise<void> {
  await waitFor(() => expect($('apa-refine-button')).not.toBeNull());
  $('apa-refine-button')!.click();
  await waitFor(() => expect($('apa-refine-review')).not.toBeNull());
  // Wait for the focus trap's effect, not just the render. Preact defers
  // effects, so the dialog is in the DOM a tick before it is wired up — and a
  // test that raced ahead of that would assert against a half-built dialog.
  await waitFor(() => expect(document.activeElement).toBe($('apa-refine-review')));
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  __resetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetForTests();
});

describe('the button', () => {
  it('is hidden when the model cannot run here', async () => {
    // Offering a control that always fails is worse than not offering it.
    installModel(() => SUGGESTION);
    mount({ available: false });

    await waitFor(() => expect($('apa-panel')).not.toBeNull());
    expect($('apa-refine-button')).toBeNull();
  });

  it('appears above the composer when the model is available', async () => {
    installModel(() => SUGGESTION);
    mount();

    await waitFor(() => expect($('apa-refine-button')).not.toBeNull());
    expect($('apa-refine-anchor')!.style.top).toBe('466px'); // 500 - 26 - 8
  });

  it('never fires without being pressed', async () => {
    // Rewriting what someone typed uninvited is presumptuous, and unlike
    // redaction there is no safety argument for it.
    const create = vi.fn();
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create });

    mount();
    await waitFor(() => expect($('apa-refine-button')).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(create).not.toHaveBeenCalled();
    expect($('apa-refine-review')).toBeNull();
  });

  it('shows progress while the model is working', async () => {
    let release!: (text: string) => void;
    installModel(() => new Promise<string>((resolve) => (release = resolve)));
    mount();

    await waitFor(() => expect($('apa-refine-button')).not.toBeNull());
    $('apa-refine-button')!.click();

    await waitFor(() => expect($('apa-refine-button')!.textContent).toContain('Improving'));

    release(SUGGESTION);
    await waitFor(() => expect($('apa-refine-review')).not.toBeNull());
  });

  it('can be stopped while it works', async () => {
    // On-device inference measured 3–11 seconds. A control that ignores you for
    // that long, with no way out but reloading the page, is worse than none.
    installModel(() => new Promise<string>(() => {}));
    mount();

    await waitFor(() => expect($('apa-refine-button')).not.toBeNull());
    $('apa-refine-button')!.click();
    await waitFor(() => expect($('apa-refine-button')!.textContent).toContain('Improving'));

    $('apa-refine-button')!.click();

    await waitFor(() => expect($('apa-refine-button')!.textContent).toBe('Improve'));
    expect($('apa-refine-review')).toBeNull();
    expect($('apa-refine-message')).toBeNull();
  });

  it('reports failure beside the button rather than in a dialog', async () => {
    // A refinement that did not work is not worth interrupting someone over:
    // their draft is untouched and they can carry on.
    mount(); // no model installed

    await waitFor(() => expect($('apa-refine-button')).not.toBeNull());
    $('apa-refine-button')!.click();

    await waitFor(() => expect($('apa-refine-message')).not.toBeNull());
    expect($('apa-refine-message')!.textContent).toContain('not available');
    expect($('apa-refine-review')).toBeNull();
  });
});

describe('coexisting with the risk badge', () => {
  const setRisk = (text = `AWS_ACCESS_KEY_ID=${AWS_KEY}`) =>
    riskStore.setRisk('high', detect(text, {}, ALL_RULES), text);

  it('does not overlap at common composer widths', async () => {
    // Both surfaces sit above the composer and can be on screen together. The
    // badge reserves the right edge, so the button takes the left.
    for (const width of [1200, 900, 768, 640, 420]) {
      document.body.innerHTML = '';
      installModel(() => SUGGESTION);
      mount({ composerRect: { left: 200, right: 200 + width, width } });
      setRisk();

      await waitFor(() => expect($('apa-risk-anchor')).not.toBeNull());
      await waitFor(() => expect($('apa-refine-anchor')).not.toBeNull());

      const gap = left($('apa-risk-anchor')!) - left($('apa-refine-anchor')!);
      expect(gap, `composer ${width}px wide`).toBeGreaterThanOrEqual(
        REFINE_GROUP_WIDTH,
      );
    }
  });

  it('hides both while a decision is being asked for', async () => {
    installModel(() => SUGGESTION);
    mount();
    setRisk();

    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());

    await invoke();

    expect($('apa-risk-badge')).toBeNull();
    expect($('apa-refine-button')).toBeNull();
  });
});

describe('the review', () => {
  it('shows what changed', async () => {
    installModel(() => SUGGESTION);
    mount({ draft: 'fix the login bug' });

    await invoke();

    const diff = $('apa-refine-diff')!;
    expect(diff.querySelector('[data-diff="added"]')).not.toBeNull();
    expect(diff.textContent).toContain('authentication');
  });

  it('warns when the rewrite is substantial', async () => {
    installModel(
      () => 'Diagnose, then fix, whatever is causing the login bug to happen.',
    );
    mount({ draft: 'fix the login bug please' });

    await invoke();

    expect($('apa-refine-summary')!.textContent).toContain('Check it still says');
  });

  it('says plainly that nothing was sent', async () => {
    installModel(() => SUGGESTION);
    mount();

    await invoke();

    expect($('apa-refine-review')!.textContent).toContain('has not been submitted');
  });

  it('accepts into the composer without submitting', async () => {
    installModel(() => SUGGESTION);
    mount();

    await invoke();
    $('apa-refine-accept')!.click();

    await waitFor(() => expect($('apa-refine-review')).toBeNull());
    expect(composerText).toBe(SUGGESTION);
  });

  it('returns the original text on undo after accepting', async () => {
    installModel(() => SUGGESTION);
    mount({ draft: ORIGINAL });

    await invoke();
    $('apa-refine-accept')!.click();
    await waitFor(() => expect(composerText).toBe(SUGGESTION));

    refineStore.undo();

    expect(composerText).toBe(ORIGINAL);
  });

  it('lets the user edit before accepting', async () => {
    installModel(() => SUGGESTION);
    mount();

    await invoke();
    $('apa-refine-edit-toggle')!.click();
    await waitFor(() => expect($('apa-refine-edit')).not.toBeNull());

    const textarea = $('apa-refine-edit') as HTMLTextAreaElement;
    textarea.value = 'my own wording';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    await waitFor(() => expect(refineStore.get().draft).toBe('my own wording'));
    $('apa-refine-accept')!.click();

    await waitFor(() => expect(composerText).toBe('my own wording'));
  });

  it('discards on Escape, leaving the draft exactly as it was', async () => {
    // Escape means "no". Applying a suggestion someone waved away would be the
    // silent rewrite the whole product promises not to do.
    installModel(() => SUGGESTION);
    mount({ draft: ORIGINAL });

    await invoke();
    $('apa-refine-review')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    await waitFor(() => expect($('apa-refine-review')).toBeNull());
    expect(composerText).toBe(ORIGINAL);
  });

  it('discards on "Keep mine"', async () => {
    installModel(() => SUGGESTION);
    mount({ draft: ORIGINAL });

    await invoke();
    $('apa-refine-discard')!.click();

    await waitFor(() => expect($('apa-refine-review')).toBeNull());
    expect(composerText).toBe(ORIGINAL);
  });
});

describe('keyboard operation', () => {
  it('takes focus when it opens and gives it back when it closes', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);

    installModel(() => SUGGESTION);
    mount();
    outside.focus();

    await invoke();
    expect(document.activeElement).toBe($('apa-refine-review'));

    $('apa-refine-discard')!.click();
    await waitFor(() => expect($('apa-refine-review')).toBeNull());

    await waitFor(() => expect(document.activeElement).toBe(outside));
  });

  it('keeps Tab inside the dialog', async () => {
    installModel(() => SUGGESTION);
    mount();

    await invoke();

    const dialog = $('apa-refine-review')!;
    const buttons = [...dialog.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(1);

    // Forward from the last control wraps to the first, rather than escaping
    // into the page behind a dialog the user cannot see past.
    buttons[buttons.length - 1]!.focus();
    buttons[buttons.length - 1]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    expect(document.activeElement).toBe(buttons[0]);

    // And backward from the first wraps to the last.
    buttons[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, shiftKey: true }),
    );
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it('reaches every control with the keyboard alone', async () => {
    installModel(() => SUGGESTION);
    mount();

    await invoke();

    for (const id of ['apa-refine-accept', 'apa-refine-edit-toggle', 'apa-refine-discard']) {
      const el = $(id)!;
      el.focus();
      expect(document.activeElement, id).toBe(el);
    }
  });

  it('is announced as a modal dialog', async () => {
    installModel(() => SUGGESTION);
    mount();

    await invoke();

    const dialog = $('apa-refine-review')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('apa-refine-title');
    expect($('apa-refine-summary')!.getAttribute('role')).toBe('status');
  });
});

describe('one question at a time', () => {
  it('lets the approval modal win over a pending review', async () => {
    // The modal is about a prompt already on its way out; a rewrite suggestion
    // can wait. Two dialogs about the same prompt is a choice nobody can make.
    installModel(() => SUGGESTION);
    mount();

    await invoke();

    const text = `AWS_ACCESS_KEY_ID=${AWS_KEY}`;
    const findings = detect(text, {}, ALL_RULES);
    store.present({
      text,
      findings,
      blocking: findings,
      held: true,
      sendOriginal: () => {},
      sendReplacement: () => {},
      cancel: () => {},
    });

    await waitFor(() => expect($('apa-modal')).not.toBeNull());
    expect($('apa-refine-review')).toBeNull();
  });
});

describe('the style picker', () => {
  /*
   * Five names for one setting, reachable from a caret next to the button.
   * It had no coverage at all before the control was rebuilt, which is how a
   * menu with role="menu" and no arrow keys survived this long.
   */

  const openPicker = async () => {
    await waitFor(() => expect($('apa-refine-style')).not.toBeNull());
    $('apa-refine-style')!.click();
    await waitFor(() => expect($('apa-refine-styles')).not.toBeNull());
  };

  const itemsInMenu = () => [
    ...$('apa-refine-styles')!.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
  ];

  it('marks the current style rather than only tinting it', async () => {
    // A background tint is invisible to a screen reader and easy to miss
    // sighted. aria-checked is the part that answers "which one am I using?"
    // without opening anything.
    installModel(() => SUGGESTION);
    mount();
    await openPicker();

    const checked = itemsInMenu().filter(
      (item) => item.getAttribute('aria-checked') === 'true',
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]!.textContent).toContain(STYLES[0]!.label);
  });

  it('opens with the current choice focused', async () => {
    installModel(() => SUGGESTION);
    mount();
    await openPicker();

    await waitFor(() =>
      expect(document.activeElement).toBe($('apa-refine-style-' + STYLES[0]!.id)),
    );
  });

  it('moves through the options with the arrow keys', async () => {
    /*
     * role="menu" is a promise that arrow keys work. Buttons in a div do not
     * keep it on their own, and a menu that only answers to Tab is one a
     * keyboard user has to escape rather than use.
     */
    installModel(() => SUGGESTION);
    mount();
    await openPicker();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));

    const menu = $('apa-refine-styles')!;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe($('apa-refine-style-' + STYLES[1]!.id));

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(
      $('apa-refine-style-' + STYLES[STYLES.length - 1]!.id),
    );

    // Wraps rather than stopping dead at the end.
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe($('apa-refine-style-' + STYLES[0]!.id));
  });

  it('closes on Escape and gives focus back to the caret', async () => {
    // Leaving focus on a removed element drops the keyboard user back at the
    // top of someone else's page.
    installModel(() => SUGGESTION);
    mount();
    await openPicker();

    $('apa-refine-styles')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    await waitFor(() => expect($('apa-refine-styles')).toBeNull());
    expect(document.activeElement).toBe($('apa-refine-style'));
  });

  it('closes when the user clicks the page behind it', async () => {
    /*
     * The host page is one click away at all times. A menu that ignored that
     * click would sit over the chat until it was dismissed on our terms.
     */
    installModel(() => SUGGESTION);
    mount();
    await openPicker();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    await waitFor(() => expect($('apa-refine-styles')).toBeNull());
  });

  it('stays open when the click lands inside it', async () => {
    installModel(() => SUGGESTION);
    mount();
    await openPicker();

    $('apa-refine-style-' + STYLES[1]!.id)!.dispatchEvent(
      new Event('pointerdown', { bubbles: true, composed: true }),
    );

    expect($('apa-refine-styles')).not.toBeNull();
  });

  it('runs the refinement in the style that was picked', async () => {
    installModel(() => SUGGESTION);
    mount();
    await openPicker();

    $('apa-refine-style-' + STYLES[1]!.id)!.click();

    await waitFor(() => expect($('apa-refine-review')).not.toBeNull());
    expect(refineStore.get().style).toBe(STYLES[1]!.id);
  });

  it('opens upward when the composer leaves room above it', async () => {
    // The control sits directly above the composer, so a downward menu covers
    // the draft the user is choosing a style for.
    installModel(() => SUGGESTION);
    mount({ composerRect: { top: 600, bottom: 660 } });
    await openPicker();

    expect($('apa-refine-styles')!.dataset.direction).toBe('up');
  });

  it('opens downward when there is no room above', async () => {
    installModel(() => SUGGESTION);
    mount({ composerRect: { top: 90, bottom: 150 } });
    await openPicker();

    expect($('apa-refine-styles')!.dataset.direction).toBe('down');
  });

  it('cannot be opened while a refinement is running', async () => {
    // Changing the style mid-run would describe a request already in flight.
    let release: (value: string) => void = () => {};
    installModel(() => new Promise<string>((resolve) => (release = resolve)));
    mount();

    await waitFor(() => expect($('apa-refine-button')).not.toBeNull());
    $('apa-refine-button')!.click();
    await waitFor(() =>
      expect(($('apa-refine-style') as HTMLButtonElement).disabled).toBe(true),
    );

    release(SUGGESTION);
  });
});

describe('the button reads as a control, not as a word', () => {
  it('names its keyboard shortcut where the pointer already is', async () => {
    /*
     * Alt+Shift+I was previously discoverable only by opening settings. The
     * tooltip and aria-keyshortcuts put it on the control itself, which is
     * where someone wondering about it is already looking.
     */
    installModel(() => SUGGESTION);
    mount();

    await waitFor(() => expect($('apa-refine-button')).not.toBeNull());
    expect($('apa-refine-button')!.getAttribute('title')).toContain('Alt+Shift+I');
    expect($('apa-refine-button')!.getAttribute('aria-keyshortcuts')).toBe('Alt+Shift+I');
  });

  it('shows a spinner while it works, not just a different word', async () => {
    // Measured p90 is 10.1 seconds. A static label for that long reads as a
    // control that has stopped responding.
    let release: (value: string) => void = () => {};
    installModel(() => new Promise<string>((resolve) => (release = resolve)));
    mount();

    await waitFor(() => expect($('apa-refine-button')).not.toBeNull());
    $('apa-refine-button')!.click();

    await waitFor(() =>
      expect($('apa-refine-button')!.querySelector('.apa-spin')).not.toBeNull(),
    );

    release(SUGGESTION);
  });

  it('says it can be stopped, in words a screen reader reaches', async () => {
    // The cancel affordance used to be a bare glyph inside the visible label.
    let release: (value: string) => void = () => {};
    installModel(() => new Promise<string>((resolve) => (release = resolve)));
    mount();

    await waitFor(() => expect($('apa-refine-button')).not.toBeNull());
    $('apa-refine-button')!.click();

    await waitFor(() =>
      expect($('apa-refine-button')!.getAttribute('aria-label')).toContain('Stop'),
    );

    release(SUGGESTION);
  });

  it('keeps every icon out of the accessibility tree', async () => {
    // Each one sits beside a real label, so announcing them would only add
    // noise to a control that already says what it does.
    installModel(() => SUGGESTION);
    mount();

    await waitFor(() => expect($('apa-refine-anchor')).not.toBeNull());
    const svgs = [...$('apa-refine-anchor')!.querySelectorAll('svg')];

    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect(svg.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the style menu fits on the screen', () => {
  const openPicker = async () => {
    await waitFor(() => expect($('apa-refine-style')).not.toBeNull());
    $('apa-refine-style')!.click();
    await waitFor(() => expect($('apa-refine-styles')).not.toBeNull());
  };

  it('caps its height to the room it has, and scrolls inside', async () => {
    /*
     * Picking a side keeps the menu on screen at a normal window size. It does
     * not survive a short window or a zoomed browser, where the last option
     * ends up under the edge with no way to reach it.
     */
    installModel(() => SUGGESTION);
    mount({ composerRect: { top: 600, bottom: 660 } });
    await openPicker();

    const menu = $('apa-refine-styles')!;
    const maxHeight = Number.parseFloat(menu.style.maxHeight);

    expect(maxHeight).toBeGreaterThan(0);
    expect(maxHeight).toBeLessThanOrEqual(window.innerHeight);
    expect(menu.className).toContain('overflow-y-auto');
  });

  it('keeps a usable minimum when squeezed from both sides', async () => {
    installModel(() => SUGGESTION);
    mount({ composerRect: { top: 40, bottom: 100 } });
    await openPicker();

    const maxHeight = Number.parseFloat($('apa-refine-styles')!.style.maxHeight);
    expect(maxHeight).toBeGreaterThanOrEqual(120);
  });

  it('anchors to the side it opened toward', async () => {
    installModel(() => SUGGESTION);
    mount({ composerRect: { top: 600, bottom: 660 } });
    await openPicker();

    const menu = $('apa-refine-styles')!;
    expect(menu.dataset.direction).toBe('up');
    expect(menu.style.bottom).not.toBe('');
    expect(menu.style.top).toBe('');
  });
});
