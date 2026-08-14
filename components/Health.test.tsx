import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { Panel } from './Panel';
import { createPanelStore, type PanelStore } from './panel-store';
import type { HealthLevel } from '@/lib/health';

/**
 * The visible health surface.
 *
 * The failure this milestone exists to prevent is silent: the extension stops
 * working, keeps looking installed, and the user carries on typing secrets
 * into a box they believe is watched. Every test here is a version of the same
 * question — can the user tell?
 */

let container: HTMLElement;
let composer: HTMLElement;
let store: PanelStore;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** jsdom reports 0×0 for everything; the anchor hook rejects zero-size rects. */
function giveLayout(el: HTMLElement) {
  el.getBoundingClientRect = () =>
    ({ top: 500, left: 200, right: 900, bottom: 560, width: 700, height: 60 }) as DOMRect;
}

function mount(health: HealthLevel, resolvedVia: string | null = null) {
  render(
    <Panel
      store={store}
      getComposer={() => composer}
      health={health}
      healthResolvedVia={resolvedVia}
    />,
    container,
  );
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);

  composer = document.createElement('div');
  composer.setAttribute('contenteditable', 'true');
  giveLayout(composer);
  document.body.append(composer);

  store = createPanelStore({});
});

afterEach(() => {
  render(null, container);
  container.remove();
  composer.remove();
});

describe('total failure is visible', () => {
  it('says plainly that nothing is being checked', () => {
    mount('unavailable');

    const notice = $('apa-health-notice');
    expect(notice).not.toBeNull();
    expect(notice?.dataset.level).toBe('unavailable');
    expect($('apa-health-message')?.textContent).toContain('Protection unavailable');
    // The consequence, not just the state. "Unavailable" alone invites the
    // reading that some lesser protection is still running.
    expect($('apa-health-message')?.textContent).toContain('Nothing is being checked');
  });

  it('announces itself to a screen reader as an alert', () => {
    // A change in whether the user is protected should interrupt.
    mount('unavailable');

    expect($('apa-health-notice')?.getAttribute('role')).toBe('alert');
  });

  it('does not block the page', () => {
    /*
     * Telling someone their seatbelt is undone should not lock the doors. No
     * backdrop, no modal, nothing held.
     */
    mount('unavailable');

    expect(container.querySelector('[aria-modal]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('when there is no composer to anchor to', () => {
  it('still shows, because that is the case it exists for', () => {
    /*
     * A regression test for a bug the end-to-end suite found and every test in
     * this file missed.
     *
     * The notice used to be anchored to the composer like every other surface,
     * and Panel gated it on the anchor being present. So when the composer
     * could not be found — the exact condition "protection unavailable" reports
     * — there was no anchor, and the message never rendered.
     *
     * The reason no unit test caught it is worth remembering: every test here
     * supplies a composer, because supplying one is what makes a test set up.
     * The failure only appears when the page genuinely lacks one.
     */
    composer.remove();

    mount('unavailable');

    expect($('apa-health-notice')).not.toBeNull();
    expect($('apa-health-message')?.textContent).toContain('Protection unavailable');
  });
});

describe('degraded is distinct from broken', () => {
  it('says protection is running, but less precisely', () => {
    mount('degraded', 'editable-near-submit');

    const message = $('apa-health-message')?.textContent ?? '';
    expect(message).toContain('Protection is running');
    expect(message).not.toContain('Nothing is being checked');
  });

  it('does not interrupt a screen reader for it', () => {
    // A change in *how* the user is protected, not *whether*. Worth saying,
    // not worth interrupting for.
    mount('degraded', 'focused-editable');

    expect($('apa-health-notice')?.getAttribute('role')).toBe('status');
  });

  it('names the fallback in use, so a bug report can be specific', () => {
    mount('degraded', 'editable-near-submit');

    // A strategy name — never anything read from the page.
    expect($('apa-health-via')?.textContent).toBe('editable-near-submit');
  });
});

describe('healthy is silent', () => {
  it('shows nothing at all', () => {
    // A badge that says "working" on every page load is noise, and noise is
    // what makes the one important message invisible.
    mount('healthy');

    expect($('apa-health-notice')).toBeNull();
  });
});

describe('dismissing', () => {
  it('can be dismissed without turning anything off', async () => {
    mount('unavailable');
    $('apa-health-dismiss')?.click();

    // Preact schedules the re-render rather than doing it inside the click.
    await vi.waitFor(() => expect($('apa-health-notice')).toBeNull());

    // Dismissing the message is not consent to being unprotected — the panel
    // is still mounted and the state is unchanged underneath.
    expect($('apa-panel')).not.toBeNull();
  });
});
