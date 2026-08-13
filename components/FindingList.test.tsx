import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { Panel } from './Panel';
import { createPanelStore, type PanelStore } from './panel-store';
import { detect } from '@/lib/detector/engine';
import { ALL_RULES } from '@/lib/detector/rules';
import type { HeldSubmission } from '@/lib/interception/controller';

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';
const STRIPE_KEY = 'sk_live_9mQ4vX2nR7tK1pL5wZ8yB3cF';

function submissionFor(text: string): HeldSubmission {
  const findings = detect(text, {}, ALL_RULES);
  return {
    text,
    findings,
    blocking: findings.filter((f) => f.tier === 'high'),
    held: true,
    sendOriginal: () => {},
    sendReplacement: () => {},
    cancel: () => {},
  };
}

let container: HTMLElement;
let store: PanelStore;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const $$ = (id: string) => [...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];

const waitFor = (assertion: () => void) => vi.waitFor(assertion, { timeout: 1000 });

function mount(config: Parameters<typeof createPanelStore>[0] = {}): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  store = createPanelStore(config);
  render(<Panel store={store} />, container);
}

async function present(text: string): Promise<void> {
  store.present(submissionFor(text));
  await waitFor(() => expect($('apa-modal')).not.toBeNull());
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('rows', () => {
  it('shows one row per distinct value', async () => {
    mount();
    await present(`AWS_ACCESS_KEY_ID=${AWS_KEY}\nSTRIPE_SECRET_KEY=${STRIPE_KEY}`);

    expect($$('apa-finding-row')).toHaveLength(2);
  });

  it('collapses a repeated value into one row with a count', async () => {
    // A key pasted three times is one decision, not three.
    mount();
    await present(`key ${AWS_KEY} again ${AWS_KEY} and ${AWS_KEY}`);

    const rows = $$('apa-finding-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('×3');
  });

  it('shows the change as masked value → placeholder', async () => {
    mount();
    await present(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);

    expect($('apa-finding-masked')!.textContent).toBe('AKIA…TIC7');
    expect($('apa-finding-placeholder')!.textContent).toContain('[REDACTED_');
  });

  it('never renders a full secret value', async () => {
    // A conventional before/after diff was rejected precisely because it would
    // put every secret back on screen at full length.
    mount();
    await present(`AWS_ACCESS_KEY_ID=${AWS_KEY}\nSTRIPE_SECRET_KEY=${STRIPE_KEY}`);

    const text = $('apa-finding-list')!.textContent ?? '';
    expect(text).not.toContain(AWS_KEY);
    expect(text).not.toContain(STRIPE_KEY);
  });
});

describe('per-finding toggles', () => {
  it('starts with everything selected', async () => {
    mount();
    await present(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);

    const toggle = $('apa-finding-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('updates the preview immediately when a finding is deselected', async () => {
    mount();
    await present(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    expect($('apa-preview')!.textContent).toContain('[REDACTED_');

    ($('apa-finding-toggle') as HTMLInputElement).click();

    await waitFor(() => {
      expect($('apa-preview')!.textContent).toContain(AWS_KEY);
      expect($('apa-preview')!.textContent).not.toContain('[REDACTED_');
    });
  });

  it('shows a deselected row as unchanged', async () => {
    mount();
    await present(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);

    ($('apa-finding-toggle') as HTMLInputElement).click();

    await waitFor(() =>
      expect($('apa-finding-placeholder')!.textContent).toBe('unchanged'),
    );
  });

  it('toggles back on', async () => {
    mount();
    await present(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);

    const toggle = () => $('apa-finding-toggle') as HTMLInputElement;
    toggle().click();
    await waitFor(() => expect(toggle().checked).toBe(false));
    toggle().click();
    await waitFor(() => expect(toggle().checked).toBe(true));

    expect($('apa-preview')!.textContent).toContain('[REDACTED_');
  });

  it('leaves other findings alone', async () => {
    mount();
    await present(`AWS_ACCESS_KEY_ID=${AWS_KEY}\nSTRIPE_SECRET_KEY=${STRIPE_KEY}`);

    const toggles = () =>
      $$('apa-finding-toggle') as unknown as HTMLInputElement[];
    toggles()[0]!.click();

    await waitFor(() => expect(toggles()[0]!.checked).toBe(false));
    expect(toggles()[1]!.checked).toBe(true);
  });
});

describe('allowlisting', () => {
  it('reports the real value to the allowlist handler', async () => {
    const onAllowlist = vi.fn();
    mount({ onAllowlist });
    await present(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);

    $('apa-finding-allowlist')!.click();

    await waitFor(() => expect(onAllowlist).toHaveBeenCalledWith(AWS_KEY));
  });

  it('stops redacting the value in this prompt too', async () => {
    // Recording "this is fine" and still replacing it here would be incoherent.
    mount({ onAllowlist: () => {} });
    await present(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);

    $('apa-finding-allowlist')!.click();

    await waitFor(() => expect($('apa-preview')!.textContent).toContain(AWS_KEY));
  });

  it('does nothing harmful when no handler is wired', async () => {
    mount();
    await present(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);

    expect(() => $('apa-finding-allowlist')!.click()).not.toThrow();
  });
});

describe('advisory findings', () => {
  const mixed = `AWS_ACCESS_KEY_ID=${AWS_KEY}\ncontact sarah.chen@northwind-labs.io`;

  it('collapses advisory items by default', async () => {
    // Letting a list of email addresses push real credentials off screen would
    // invert the priority the tier system exists to express.
    mount();
    await present(mixed);

    expect($('apa-advisory-list')).toBeNull();
    expect($('apa-advisory-toggle')!.textContent).toContain('1 advisory item');
  });

  it('keeps blocking findings visible without expanding', async () => {
    mount();
    await present(mixed);

    const rows = $$('apa-finding-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('AWS Access Key ID');
  });

  it('expands on request', async () => {
    mount();
    await present(mixed);

    $('apa-advisory-toggle')!.click();

    await waitFor(() => expect($('apa-advisory-list')).not.toBeNull());
    expect($('apa-advisory-list')!.textContent).toContain('Email Address');
  });

  it('shows no toggle when there is nothing advisory', async () => {
    mount();
    await present(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);

    expect($('apa-advisory-toggle')).toBeNull();
  });
});
