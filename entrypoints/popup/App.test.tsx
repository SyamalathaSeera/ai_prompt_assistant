import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from './App';
import { put, size } from '@/lib/vault';

const SECRET = 'AKIA3TZ2MRSYNTHETIC7';
const CHAT = 'conversation-a';

let container: HTMLElement;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const waitFor = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000 });

function mount(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  render(<App />, container);
}

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = '';
});

describe('vault visibility', () => {
  it('reports an empty vault', async () => {
    mount();
    await waitFor(() => expect($('vault-count')!.textContent).toBe('0'));
  });

  it('reports how many values are held', async () => {
    // A tool that keeps secrets in memory has to be able to answer
    // "what do you have of mine?".
    await put('[REDACTED_A_1]', SECRET, CHAT);
    await put('[REDACTED_B_1]', 'another', CHAT);

    mount();
    await waitFor(() => expect($('vault-count')!.textContent).toBe('2'));
  });

  it('never displays a stored value', async () => {
    // Answering the question must not itself become a leak.
    await put('[REDACTED_A_1]', SECRET, CHAT);

    mount();
    await waitFor(() => expect($('vault-count')!.textContent).toBe('1'));

    expect(container.textContent).not.toContain(SECRET);
  });

  it('explains when values disappear on their own', async () => {
    mount();
    await waitFor(() => expect($('vault-count')).not.toBeNull());

    const text = container.textContent ?? '';
    expect(text).toContain('close the browser');
    expect(text).toContain('hours unused');
  });
});

describe('clearing', () => {
  it('empties the vault immediately', async () => {
    await put('[REDACTED_A_1]', SECRET, CHAT);
    mount();
    await waitFor(() => expect($('vault-count')!.textContent).toBe('1'));

    $('vault-clear')!.click();

    await waitFor(() => expect($('vault-count')!.textContent).toBe('0'));
    expect(await size()).toBe(0);
  });

  it('removes the values from storage, not just the display', async () => {
    await put('[REDACTED_A_1]', SECRET, CHAT);
    mount();
    await waitFor(() => expect($('vault-count')!.textContent).toBe('1'));

    $('vault-clear')!.click();

    await waitFor(async () => {
      const session = await fakeBrowser.storage.session.get(null);
      expect(JSON.stringify(session)).not.toContain(SECRET);
    });
  });

  it('disables the control when there is nothing to clear', async () => {
    mount();
    await waitFor(() =>
      expect(($('vault-clear') as HTMLButtonElement).disabled).toBe(true),
    );
  });

  it('does not break when storage is unavailable', async () => {
    const original = fakeBrowser.storage.session.get;
    fakeBrowser.storage.session.get = () => Promise.reject(new Error('unavailable'));

    mount();
    await waitFor(() => expect($('vault-count')!.textContent).toBe('0'));

    fakeBrowser.storage.session.get = original;
  });
});

describe('the local-only claim', () => {
  it('states it plainly', async () => {
    // This sentence is the entire install-time pitch. It appears where the
    // user looks when they wonder what the extension is doing.
    mount();
    await waitFor(() => expect($('vault-count')).not.toBeNull());

    expect(container.textContent).toContain('Nothing you type leaves this device');
  });
});
