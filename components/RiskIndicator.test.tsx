import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { Panel } from './Panel';
import { createPanelStore } from './panel-store';
import { createRiskStore, type RiskStore } from './risk-store';
import { detect } from '@/lib/detector/engine';
import { ALL_RULES } from '@/lib/detector/rules';
import { DEFAULT_SETTINGS } from '@/lib/policy/defaults';

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';
const TEXT = `AWS_ACCESS_KEY_ID=${AWS_KEY}`;

let container: HTMLElement;
let riskStore: RiskStore;
let composer: HTMLElement;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
// Generous timeout: these assertions wait on a requestAnimationFrame chain,
// which is scheduled at the mercy of whatever else the machine is doing while
// the other test projects run in parallel.
const waitFor = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000 });

/** jsdom reports 0×0 for everything; the anchor hook rejects zero-size rects. */
function giveLayout(el: HTMLElement, rect: Partial<DOMRect> = {}) {
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

function mount(
  config: Parameters<typeof createRiskStore>[0] = {},
  /** Where the composer sits, for the tests about fitting on screen. */
  rect: Partial<DOMRect> = {},
): void {
  container = document.createElement('div');
  document.body.appendChild(container);

  composer = document.createElement('div');
  composer.id = 'composer';
  document.body.appendChild(composer);
  giveLayout(composer, rect);

  riskStore = createRiskStore(config);

  render(
    <Panel
      store={createPanelStore()}
      riskStore={riskStore}
      getComposer={() => composer}
    />,
    container,
  );
}

function setRisk(text = TEXT): void {
  const findings = detect(text, {}, ALL_RULES);
  const high = findings.filter((f) => f.tier === 'high').length;
  riskStore.setRisk(high > 0 ? 'high' : 'low', findings, text);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('visibility', () => {
  it('shows nothing when there is no risk', async () => {
    mount();
    await waitFor(() => expect($('apa-panel')).not.toBeNull());
    expect($('apa-risk-badge')).toBeNull();
  });

  it('appears when the draft contains a secret', async () => {
    mount();
    setRisk();
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());
  });

  it('disappears when the secret is removed', async () => {
    mount();
    setRisk();
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());

    riskStore.setRisk('none', [], '');
    await waitFor(() => expect($('apa-risk-badge')).toBeNull());
  });

  it('hides when the composer cannot be found', async () => {
    // Mid-navigation the composer is swapped out. A badge floating over
    // nothing would look like a rendering bug.
    mount();
    setRisk();
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());

    giveLayout(composer, { width: 0, height: 0 });
    window.dispatchEvent(new Event('resize'));

    await waitFor(() => expect($('apa-risk-badge')).toBeNull());
  });
});

describe('levels', () => {
  it('reports high for a blocking finding', async () => {
    mount();
    setRisk();
    await waitFor(() =>
      expect($('apa-risk-badge')!.getAttribute('data-level')).toBe('high'),
    );
  });

  it('reports low for advisory findings only', async () => {
    mount();
    setRisk('reach me at sarah.chen@northwind-labs.io');
    await waitFor(() =>
      expect($('apa-risk-badge')!.getAttribute('data-level')).toBe('low'),
    );
  });
});

describe('positioning', () => {
  it('sits above the composer, clear of the send button', async () => {
    // ChatGPT's send, attach, and dictation controls all live along the
    // composer's bottom edge. Covering any of them would put the extension
    // between the user and their work.
    mount();
    setRisk();
    await waitFor(() => expect($('apa-risk-anchor')).not.toBeNull());

    const top = Number.parseFloat($('apa-risk-anchor')!.style.top);
    expect(top).toBeLessThan(500);
  });

  it('never positions itself off the top of the viewport', async () => {
    mount();
    giveLayout(composer, { top: 4, bottom: 64, left: 200, right: 900 });
    setRisk();
    await waitFor(() => expect($('apa-risk-anchor')).not.toBeNull());

    expect(Number.parseFloat($('apa-risk-anchor')!.style.top)).toBeGreaterThanOrEqual(0);
  });

  it('follows the composer when the window resizes', async () => {
    mount();
    setRisk();
    await waitFor(() => expect($('apa-risk-anchor')).not.toBeNull());
    const before = $('apa-risk-anchor')!.style.top;

    giveLayout(composer, { top: 200, bottom: 260, left: 200, right: 900 });
    window.dispatchEvent(new Event('resize'));

    await waitFor(() => expect($('apa-risk-anchor')!.style.top).not.toBe(before));
  });

  it('does not insert anything into the host page', async () => {
    // Injecting into ChatGPT's layout would shift it, and a tool that visibly
    // rearranges the page it protects reads as breakage.
    mount();
    setRisk();
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());

    expect(composer.children).toHaveLength(0);
    expect(composer.parentElement).toBe(document.body);
  });
});

describe('the popover', () => {
  it('opens on click without submitting anything', async () => {
    mount();
    setRisk();
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());

    $('apa-risk-badge')!.click();
    await waitFor(() => expect($('apa-risk-popover')).not.toBeNull());
  });

  it('lists findings with masked values only', async () => {
    mount();
    setRisk();
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());
    $('apa-risk-badge')!.click();
    await waitFor(() => expect($('apa-risk-popover')).not.toBeNull());

    expect($('apa-risk-masked')!.textContent).toBe('AKIA…TIC7');
    expect($('apa-risk-popover')!.textContent).not.toContain(AWS_KEY);
  });

  it('says nothing has been sent', async () => {
    mount();
    setRisk();
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());
    $('apa-risk-badge')!.click();

    await waitFor(() =>
      expect($('apa-risk-popover')!.textContent).toContain('Nothing has been sent'),
    );
  });

  it('rewrites the composer without submitting', async () => {
    const onApplyRedaction = vi.fn();
    mount({ onApplyRedaction });
    setRisk();
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());
    $('apa-risk-badge')!.click();
    await waitFor(() => expect($('apa-risk-apply')).not.toBeNull());

    $('apa-risk-apply')!.click();

    await waitFor(() => expect(onApplyRedaction).toHaveBeenCalledTimes(1));
    const applied = onApplyRedaction.mock.calls[0]![0] as string;
    expect(applied).toContain('[REDACTED_');
    expect(applied).not.toContain(AWS_KEY);
  });

  it('closes after applying', async () => {
    mount({ onApplyRedaction: () => {} });
    setRisk();
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());
    $('apa-risk-badge')!.click();
    await waitFor(() => expect($('apa-risk-apply')).not.toBeNull());

    $('apa-risk-apply')!.click();
    await waitFor(() => expect($('apa-risk-popover')).toBeNull());
  });

  it('toggles shut on a second badge click', async () => {
    mount();
    setRisk();
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());

    $('apa-risk-badge')!.click();
    await waitFor(() => expect($('apa-risk-popover')).not.toBeNull());

    $('apa-risk-badge')!.click();
    await waitFor(() => expect($('apa-risk-popover')).toBeNull());
  });

  it('closes on Escape', async () => {
    mount();
    setRisk();
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());
    $('apa-risk-badge')!.click();
    await waitFor(() => expect($('apa-risk-popover')).not.toBeNull());

    $('apa-risk-popover')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await waitFor(() => expect($('apa-risk-popover')).toBeNull());
  });
});

describe('interaction with the modal', () => {
  it('hides the badge while the approval modal is open', async () => {
    // Two surfaces describing the same findings is noise, and the modal is
    // the one demanding a decision.
    container = document.createElement('div');
    document.body.appendChild(container);
    composer = document.createElement('div');
    document.body.appendChild(composer);
    giveLayout(composer);

    const panelStore = createPanelStore();
    riskStore = createRiskStore();
    render(
      <Panel store={panelStore} riskStore={riskStore} getComposer={() => composer} />,
      container,
    );

    setRisk();
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());

    const findings = detect(TEXT, {}, ALL_RULES);
    panelStore.present({
      text: TEXT,
      findings,
      blocking: findings.filter((f) => f.tier === 'high'),
      held: true,
      sendOriginal: () => {},
      sendReplacement: () => {},
      cancel: () => {},
    });

    await waitFor(() => expect($('apa-modal')).not.toBeNull());
    expect($('apa-risk-badge')).toBeNull();
  });
});

describe('redacting everything', () => {
  /*
   * The second action, for the case the first cannot cover: the live scan
   * honours the user's disabled rules and their allowlist, so the findings on
   * screen are deliberately less than the detector can see. This is the way
   * to ask for the rest, and it only ever happens on an explicit press.
   */

  const IP = '192.168.10.42';
  const MIXED = `AWS_ACCESS_KEY_ID=${AWS_KEY} deployed to ${IP}`;

  /** Sets risk the way the live scan does: under the shipped defaults. */
  function setRiskWithDefaults(text: string): void {
    const findings = detect(
      text,
      { disabledRuleIds: DEFAULT_SETTINGS.disabledRuleIds },
      ALL_RULES,
    );
    const high = findings.filter((f) => f.tier === 'high').length;
    riskStore.setRisk(high > 0 ? 'high' : 'low', findings, text);
  }

  const openPopover = async () => {
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());
    $('apa-risk-badge')!.click();
    await waitFor(() => expect($('apa-risk-popover')).not.toBeNull());
  };

  it('is offered when the settings are hiding something', async () => {
    // IP addresses are default-off, because version strings look identical.
    // That is the right default and a bad answer for the one draft that
    // genuinely contains one.
    mount({ onApplyRedaction: () => {} });
    setRiskWithDefaults(MIXED);
    await openPopover();

    expect($('apa-risk-apply-all')).not.toBeNull();
    expect($('apa-risk-more-note')).not.toBeNull();
  });

  it('takes out what the ordinary button leaves behind', async () => {
    const onApplyRedaction = vi.fn();
    mount({ onApplyRedaction });
    setRiskWithDefaults(MIXED);
    await openPopover();

    $('apa-risk-apply')!.click();
    const ordinary = onApplyRedaction.mock.calls[0]![0] as string;

    // The normal path respects the setting, so the address survives.
    expect(ordinary).not.toContain(AWS_KEY);
    expect(ordinary).toContain(IP);

    onApplyRedaction.mockClear();
    setRiskWithDefaults(MIXED);
    await openPopover();

    $('apa-risk-apply-all')!.click();
    const everything = onApplyRedaction.mock.calls[0]![0] as string;

    expect(everything).not.toContain(AWS_KEY);
    expect(everything).not.toContain(IP);
  });

  it('is not offered when it would change nothing', async () => {
    /*
     * Two buttons producing identical text is a decision the user has to stop
     * and make for no reason.
     */
    mount({ onApplyRedaction: () => {} });
    setRiskWithDefaults(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    await openPopover();

    expect($('apa-risk-apply')).not.toBeNull();
    expect($('apa-risk-apply-all')).toBeNull();
    expect($('apa-risk-more-note')).toBeNull();
  });

  it('overrides a value the user allowlisted', async () => {
    /*
     * Normally the wrong thing to do — an allowlist entry is the user saying
     * "this one is fine". It is acceptable only because reaching this button
     * takes a deliberate press, and the label says everything.
     */
    const onApplyRedaction = vi.fn();
    mount({ onApplyRedaction });

    /*
     * A second, un-allowlisted value is what puts the badge on screen at all.
     * With only the allowlisted key present the live scan reports `none` and
     * there is nothing to open — so a test that set up that state would be
     * asserting against a screen no user can reach.
     */
    const text = `AWS_ACCESS_KEY_ID=${AWS_KEY} — ask sarah.chen@northwind-labs.io`;
    const findings = detect(text, { isAllowlisted: (v) => v === AWS_KEY }, ALL_RULES);

    expect(findings.map((f) => f.ruleId)).toEqual(['pii.email']);

    riskStore.setRisk('low', findings, text);
    await openPopover();

    expect($('apa-risk-apply-all')).not.toBeNull();
    $('apa-risk-apply-all')!.click();

    await waitFor(() => expect(onApplyRedaction).toHaveBeenCalled());
    expect(onApplyRedaction.mock.calls[0]![0] as string).not.toContain(AWS_KEY);
  });
});

describe('fitting on the screen', () => {
  /*
   * The composer sits at the bottom of the window, and the badge sits just
   * above it. A panel that always opened downward therefore opened into the
   * few pixels below the badge and ran straight off the screen — the buttons
   * were unreachable and there was nothing to scroll.
   */

  const openPopover = async () => {
    await waitFor(() => expect($('apa-risk-badge')).not.toBeNull());
    $('apa-risk-badge')!.click();
    await waitFor(() => expect($('apa-risk-popover')).not.toBeNull());
  };

  it('opens upward when the composer is near the bottom', async () => {
    mount({}, { top: 500, bottom: 560 });
    setRisk();
    await openPopover();

    expect($('apa-risk-popover')!.dataset.direction).toBe('up');
  });

  it('opens downward when there is no room above', async () => {
    mount({}, { top: 90, bottom: 150 });
    setRisk();
    await openPopover();

    expect($('apa-risk-popover')!.dataset.direction).toBe('down');
  });

  it('caps its height to the room it has, and scrolls inside', async () => {
    /*
     * Choosing a side is not enough. A draft with a dozen findings overflows
     * even the taller side on a short window, and the buttons are at the
     * bottom of the panel — so the part that gets cut off is the part the
     * whole thing exists for.
     */
    mount({}, { top: 500, bottom: 560 });
    setRisk();
    await openPopover();

    const popover = $('apa-risk-popover')!;
    const maxHeight = Number.parseFloat(popover.style.maxHeight);

    expect(maxHeight).toBeGreaterThan(0);
    expect(maxHeight).toBeLessThanOrEqual(window.innerHeight);
    expect(popover.className).toContain('overflow-y-auto');
  });

  it('stays reachable even when the composer leaves almost no room', async () => {
    // Squeezed from both sides, it still gets a usable minimum and scrolls
    // rather than collapsing to nothing.
    mount({}, { top: 40, bottom: 100 });
    setRisk();
    await openPopover();

    const maxHeight = Number.parseFloat($('apa-risk-popover')!.style.maxHeight);
    expect(maxHeight).toBeGreaterThanOrEqual(180);
  });

  it('anchors to the side it opened toward', async () => {
    // Opening upward means pinning the bottom edge; leaving `top` set would
    // put it back over the composer.
    mount({}, { top: 500, bottom: 560 });
    setRisk();
    await openPopover();

    const popover = $('apa-risk-popover')!;
    expect(popover.style.bottom).not.toBe('');
    expect(popover.style.top).toBe('');
  });
});
