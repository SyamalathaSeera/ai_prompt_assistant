import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import Options from './Options';
import { ALL_RULES } from '@/lib/detector/rules';
import { __resetCacheForTests, getSettings, recordCatch, setSettings } from '@/lib/storage';
import { __resetForTests as __resetSessionForTests } from '@/lib/model/session';
import { put } from '@/lib/vault';

let container: HTMLElement;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const waitFor = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000 });

function mount(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  render(<Options />, container);
}

const ready = () => waitFor(() => expect($('setting-enabled')).not.toBeNull());

beforeEach(() => {
  fakeBrowser.reset();
  __resetCacheForTests();
  document.body.innerHTML = '';
});

describe('behaviour settings', () => {
  it('reflects stored settings', async () => {
    await setSettings({ enabled: false, scanOnPaste: false });
    mount();

    await ready();
    expect(($('setting-enabled') as HTMLInputElement).checked).toBe(false);
    expect(($('setting-paste') as HTMLInputElement).checked).toBe(false);
  });

  it('persists a change', async () => {
    mount();
    await ready();

    ($('setting-enabled') as HTMLInputElement).click();

    await waitFor(async () => expect((await getSettings()).enabled).toBe(false));
  });

  it('maps the block toggle onto highTierBehavior', async () => {
    mount();
    await ready();

    ($('setting-block') as HTMLInputElement).click();

    await waitFor(async () => expect((await getSettings()).highTierBehavior).toBe('warn'));
  });

  it('maps the placeholder toggle onto placeholderStyle', async () => {
    mount();
    await ready();

    ($('setting-dummy') as HTMLInputElement).click();

    await waitFor(async () => expect((await getSettings()).placeholderStyle).toBe('dummy'));
  });
});

describe('rule families', () => {
  it('lists every rule', async () => {
    mount();
    await ready();

    for (const rule of ALL_RULES) {
      expect($(`rule-${rule.id}`), `missing toggle for ${rule.id}`).not.toBeNull();
    }
  });

  it('describes every rule in plain language', async () => {
    // A settings page that misdescribes what it controls is worse than one
    // with no descriptions at all, so the text comes from the rule itself.
    for (const rule of ALL_RULES) {
      expect(rule.description, `${rule.id} has no description`).toBeTruthy();
    }

    mount();
    await ready();
    expect(container.textContent).toContain('Keys beginning AKIA');
  });

  it('shows a rule as enabled unless it is in the disabled list', async () => {
    await setSettings({ disabledRuleIds: ['pii.ipv4'] });
    mount();
    await ready();

    expect(($('rule-pii.ipv4') as HTMLInputElement).checked).toBe(false);
    expect(($('rule-aws.access_key_id') as HTMLInputElement).checked).toBe(true);
  });

  it('turns a rule off', async () => {
    mount();
    await ready();

    ($('rule-aws.access_key_id') as HTMLInputElement).click();

    await waitFor(async () =>
      expect((await getSettings()).disabledRuleIds).toContain('aws.access_key_id'),
    );
  });

  it('turns a rule back on', async () => {
    await setSettings({ disabledRuleIds: ['pii.ipv4'] });
    mount();
    await ready();

    ($('rule-pii.ipv4') as HTMLInputElement).click();

    await waitFor(async () =>
      expect((await getSettings()).disabledRuleIds).not.toContain('pii.ipv4'),
    );
  });

  it('separates blocking rules from advisory ones', async () => {
    mount();
    await ready();

    const text = container.textContent ?? '';
    expect(text).toContain('hold your message back');
    expect(text).toContain('only suggest');
  });
});

describe('platforms', () => {
  it('shows ChatGPT as granted and not removable', async () => {
    mount();
    await ready();

    const toggle = $('platform-chatgpt') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(true);
  });

  it('says only one site is requested at install', async () => {
    // Every host on the install screen costs conversion, and a privacy tool
    // asking for four sites invites the suspicion it is trying to allay.
    mount();
    await ready();

    expect(container.textContent).toContain('Only ChatGPT is requested when you install');
  });

  it('offers every supported platform as an enableable toggle', async () => {
    mount();
    await ready();

    for (const id of ['claude', 'gemini']) {
      const toggle = $(`platform-${id}`) as HTMLInputElement;
      expect(toggle, `missing toggle for ${id}`).not.toBeNull();
      expect(toggle.disabled, `${id} should be enableable`).toBe(false);
    }
  });

  it('states Gemini’s limitation before it is turned on', async () => {
    // A partial capability discovered as a silent absence feels like a bug;
    // the same gap stated up front is just a known limit.
    mount();
    await ready();

    expect(container.textContent).toContain('Restoring values in replies is not supported');
  });
});

describe('allowlist', () => {
  const entries = [
    { hash: 'a'.repeat(64), label: 'AWS Access Key ID', addedAt: '2026-08-13' },
    { hash: 'b'.repeat(64), label: 'Stripe Live Key', addedAt: '2026-08-12' },
  ];

  it('says there is nothing yet when empty', async () => {
    mount();
    await ready();

    expect($('allowlist-empty')).not.toBeNull();
  });

  it('lists entries by rule and date', async () => {
    await setSettings({ allowlist: entries });
    mount();
    await ready();

    const rows = container.querySelectorAll('[data-testid="allowlist-entry"]');
    expect(rows).toHaveLength(2);
    expect(container.textContent).toContain('AWS Access Key ID');
    expect(container.textContent).toContain('Added 2026-08-13');
  });

  it('explains that values cannot be shown', async () => {
    // The list is identifiable without being a place secrets accumulate, and
    // the UI has to say so or the omission looks like an oversight.
    await setSettings({ allowlist: entries });
    mount();
    await ready();

    expect(container.textContent).toContain('one-way hashes');
    expect(container.textContent).toContain('never shown');
  });

  it('never renders a stored hash', async () => {
    await setSettings({ allowlist: entries });
    mount();
    await ready();

    expect(container.textContent).not.toContain('a'.repeat(64));
  });

  it('removes a single entry', async () => {
    await setSettings({ allowlist: entries });
    mount();
    await ready();

    $(`allowlist-remove-${'a'.repeat(8)}`)!.click();

    await waitFor(async () => {
      const settings = await getSettings();
      expect(settings.allowlist.map((e) => e.label)).toEqual(['Stripe Live Key']);
    });
  });

  it('clears every entry', async () => {
    await setSettings({ allowlist: entries });
    mount();
    await ready();

    $('allowlist-clear')!.click();

    await waitFor(async () => expect((await getSettings()).allowlist).toEqual([]));
    expect($('allowlist-empty')).not.toBeNull();
  });
});

describe('privacy section', () => {
  it('states what is read, stored, and sent', async () => {
    mount();
    await ready();

    const text = container.textContent ?? '';
    expect(text).toContain('What is read');
    expect(text).toContain('What is stored on this device');
    expect(text).toContain('What is sent anywhere');
  });

  it('tells the user how to verify the claim themselves', async () => {
    // A tool that explains how to check it is more credible than one that
    // asks to be trusted.
    mount();
    await ready();

    expect(container.textContent).toContain('watch');
    expect(container.textContent).toContain('Network tab');
  });

  it('deletes settings, counters, and the vault', async () => {
    await setSettings({ enabled: false });
    await recordCatch('aws.access_key_id');
    await put('[REDACTED_A_1]', 'AKIA3TZ2MRSYNTHETIC7', 'chat');

    mount();
    await ready();

    $('delete-all')!.click();

    await waitFor(() => expect($('delete-confirmed')).not.toBeNull());
    expect((await getSettings()).enabled).toBe(true);
    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
  });

  it('shows the settings actually reset afterwards', async () => {
    await setSettings({ enabled: false });
    mount();
    await waitFor(() =>
      expect(($('setting-enabled') as HTMLInputElement).checked).toBe(false),
    );

    $('delete-all')!.click();

    await waitFor(() =>
      expect(($('setting-enabled') as HTMLInputElement).checked).toBe(true),
    );
  });
});

describe('prompt improvement', () => {
  /** Stands in for Chrome's Prompt API at a chosen availability. */
  function installModel(
    availability: string,
    create: () => Promise<unknown> = async () => ({
      prompt: async () => '',
      destroy: () => {},
    }),
  ) {
    vi.stubGlobal('LanguageModel', { availability: async () => availability, create });
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
    __resetSessionForTests();
  });

  it('explains the absence rather than hiding the feature silently', async () => {
    // The composer button is hidden on hardware that cannot run a model, so
    // this is the only place that absence is accounted for.
    mount();
    await ready();

    await waitFor(() => expect($('model-unavailable')).not.toBeNull());
    expect($('model-unavailable')!.textContent).toContain('does not');
    expect($('setting-refine-style')).toBeNull();
  });

  it('says redaction still works without a model', async () => {
    mount();
    await ready();

    await waitFor(() => expect($('model-unavailable')).not.toBeNull());
    expect($('model-unavailable')!.textContent).toContain('redacted');
  });

  it('offers the style choice when a model is available', async () => {
    installModel('available');
    mount();
    await ready();

    await waitFor(() => expect($('setting-refine-style')).not.toBeNull());
    expect($('model-unavailable')).toBeNull();
  });

  it('persists the chosen style', async () => {
    installModel('available');
    mount();
    await ready();
    await waitFor(() => expect($('setting-refine-style')).not.toBeNull());

    const select = $('setting-refine-style') as HTMLSelectElement;
    select.value = 'concise';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(async () => expect((await getSettings()).refineStyle).toBe('concise'));
  });

  it('tells the user the shortcut and how to change it', async () => {
    installModel('available');
    mount();
    await ready();

    await waitFor(() => expect($('model-shortcut')).not.toBeNull());
    expect($('model-shortcut')!.textContent).toContain('chrome://extensions/shortcuts');
  });

  it('offers the one-time download rather than leaving a dead end', async () => {
    // `run()` never starts the download itself, so without this control the
    // "needs downloading" state could never be left.
    installModel('downloadable');
    mount();
    await ready();

    await waitFor(() => expect($('model-download')).not.toBeNull());
    expect($('model-download')!.textContent).toContain('Download');
  });

  it('reports a failed download without alarming the user', async () => {
    installModel('downloadable', () => Promise.reject(new Error('declined')));
    mount();
    await ready();
    await waitFor(() => expect($('model-download')).not.toBeNull());

    $('model-download')!.click();

    await waitFor(() => expect($('model-download-failed')).not.toBeNull());
    expect($('model-download-failed')!.textContent).toContain('still works');
  });

  it('offers no download when the model is already there', async () => {
    installModel('available');
    mount();
    await ready();

    await waitFor(() => expect($('setting-refine-style')).not.toBeNull());
    expect($('model-download')).toBeNull();
  });
});
