import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { Panel } from './Panel';
import { createPanelStore } from './panel-store';
import { createRiskStore, type RiskStore } from './risk-store';
import { detect } from '@/lib/detector/engine';
import { ALL_RULES } from '@/lib/detector/rules';

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

function mount(config: Parameters<typeof createRiskStore>[0] = {}): void {
  container = document.createElement('div');
  document.body.appendChild(container);

  composer = document.createElement('div');
  composer.id = 'composer';
  document.body.appendChild(composer);
  giveLayout(composer);

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
