import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'preact';
import { Panel } from './Panel';
import { createPanelStore } from './panel-store';
import { detectTheme } from './theme';

/**
 * Shadow-root mount tests.
 *
 * These verify the isolation properties the injected UI depends on. WXT's
 * `createShadowRootUi` does the real mounting in production; here the same
 * shape is assembled by hand so the guarantees can be asserted without a
 * content-script context.
 */

function mountInShadow(): {
  host: HTMLElement;
  shadow: ShadowRoot;
  container: HTMLElement;
} {
  const host = document.createElement('ai-prompt-assistant');
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  container.setAttribute('data-theme', detectTheme());
  shadow.appendChild(container);

  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'none';

  return { host, shadow, container };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.className = '';
});

describe('shadow root isolation', () => {
  it('renders the panel inside the shadow root', () => {
    const { shadow, container } = mountInShadow();

    render(<Panel store={createPanelStore()} />, container);

    expect(shadow.querySelector('[data-testid="apa-panel"]')).not.toBeNull();
    render(null, container);
  });

  it('keeps the panel out of the host page tree', () => {
    // A page script querying the document must not see our UI, and page CSS
    // must not be able to select it.
    const { container } = mountInShadow();

    render(<Panel store={createPanelStore()} />, container);

    expect(document.querySelector('[data-testid="apa-panel"]')).toBeNull();
    render(null, container);
  });

  it('stacks above host page overlays', () => {
    const { host } = mountInShadow();
    // ChatGPT's own modals sit in the low thousands; this is the maximum a
    // 32-bit z-index allows, so nothing on the page can cover our panel.
    expect(host.style.zIndex).toBe('2147483647');
  });

  it('does not swallow clicks on the page beneath it', () => {
    // The host covers the whole viewport so a modal can be centred in it.
    // Without pointer-events: none it would make the entire page unclickable.
    const { host } = mountInShadow();
    expect(host.style.pointerEvents).toBe('none');
  });

  it('stamps the resolved theme on the container', () => {
    document.documentElement.classList.add('dark');
    const { container } = mountInShadow();
    expect(container.getAttribute('data-theme')).toBe('dark');
  });

  it('unmounts cleanly, leaving nothing behind', () => {
    const { shadow, container } = mountInShadow();

    render(<Panel store={createPanelStore()} />, container);
    render(null, container);

    expect(shadow.querySelector('[data-testid="apa-panel"]')).toBeNull();
  });
});
