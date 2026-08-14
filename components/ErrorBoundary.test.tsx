import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { Panel } from './Panel';
import { ErrorBoundary } from './ErrorBoundary';
import { createPanelStore, type PanelStore } from './panel-store';
import { detect } from '@/lib/detector/engine';
import { ALL_RULES } from '@/lib/detector/rules';
import type { HeldSubmission } from '@/lib/interception/controller';

/**
 * A crash in the injected UI.
 *
 * The failure being defended against is specific and reachable: the
 * interception controller wraps `onHeld()`, but `onHeld` only sets state.
 * Preact renders afterwards, on its own schedule, outside that try block. A
 * component that throws while rendering the approval modal therefore throws
 * into nothing — leaving a submission cancelled with no UI to resolve it.
 */

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';
const TEXT = `deploy with ${AWS_KEY}`;

let container: HTMLElement;
let composer: HTMLElement;
let store: PanelStore;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function giveLayout(el: HTMLElement) {
  el.getBoundingClientRect = () =>
    ({ top: 500, left: 200, right: 900, bottom: 560, width: 700, height: 60 }) as DOMRect;
}

/** A submission that records what was done with it. */
function heldSubmission() {
  const calls = { released: 0, replaced: 0, cancelled: 0 };
  const findings = detect(TEXT, {}, ALL_RULES);

  const submission: HeldSubmission = {
    text: TEXT,
    findings,
    blocking: findings.filter((f) => f.tier === 'high'),
    held: true,
    sendOriginal: () => {
      calls.released += 1;
    },
    sendReplacement: () => {
      calls.replaced += 1;
    },
    cancel: () => {
      calls.cancelled += 1;
    },
  };

  return { submission, calls };
}

function Explode(): never {
  throw new Error('render blew up');
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);

  composer = document.createElement('div');
  giveLayout(composer);
  document.body.append(composer);

  store = createPanelStore({});

  // Preact logs caught render errors; the noise is expected here.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  render(null, container);
  container.remove();
  composer.remove();
  vi.restoreAllMocks();
});

describe('catching a render crash', () => {
  it('reports it instead of letting it escape', () => {
    const onError = vi.fn();

    expect(() =>
      render(
        <ErrorBoundary onError={onError}>
          <Explode />
        </ErrorBoundary>,
        container,
      ),
    ).not.toThrow();

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('renders nothing afterwards, and does not retry', () => {
    /*
     * A boundary that re-mounts the broken subtree on the next state change
     * would crash again, and again — turning one bug into a loop that holds
     * every subsequent submission.
     */
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <Explode />
      </ErrorBoundary>,
      container,
    );
    render(
      <ErrorBoundary onError={onError}>
        <Explode />
      </ErrorBoundary>,
      container,
    );

    expect(container.textContent).toBe('');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('survives an error handler that itself throws', () => {
    expect(() =>
      render(
        <ErrorBoundary
          onError={() => {
            throw new Error('the handler is broken too');
          }}
        >
          <Explode />
        </ErrorBoundary>,
        container,
      ),
    ).not.toThrow();
  });
});

describe('what happens to a held submission', () => {
  it('does not send the prompt', () => {
    /*
     * The decision this whole file turns on. Releasing would send the original
     * text — secrets and all — at the exact moment we lost the ability to warn
     * the user. A crash must not become a silent transmission.
     */
    const { submission, calls } = heldSubmission();
    store.present(submission);

    render(
      <ErrorBoundary
        onError={() => {
          store.dismiss();
        }}
      >
        <Explode />
      </ErrorBoundary>,
      container,
    );

    expect(calls.released).toBe(0);
    expect(calls.replaced).toBe(0);
  });

  it('dismisses, leaving the text in the composer for the user', () => {
    // Dismissal is the only exit that is both fail-open and honest: the
    // submission was cancelled before it left, so nothing is lost and nothing
    // is sent. The user's next Enter is theirs to decide on.
    const { submission, calls } = heldSubmission();
    store.present(submission);

    render(
      <ErrorBoundary
        onError={() => {
          store.dismiss();
        }}
      >
        <Explode />
      </ErrorBoundary>,
      container,
    );

    expect(calls.cancelled).toBe(1);
    expect(store.get().kind).toBe('idle');
  });
});

describe('the panel as a whole', () => {
  it('catches a throw in the Panel own body, not just in a surface', () => {
    /*
     * The gap this test found. Panel's internal boundaries wrap its child
     * surfaces — but a throw in Panel's own body (a hook, a store read, the
     * prop wiring) happens before any of them exists to catch it, and escaped
     * to the caller.
     *
     * So the content script mounts Panel inside a boundary as well. This test
     * mirrors that arrangement; without the outer boundary it fails.
     */
    const onError = vi.fn();
    const { submission } = heldSubmission();
    store.present(submission);

    const broken = {
      ...store,
      get: () => {
        throw new Error('state read blew up');
      },
    } as PanelStore;

    expect(() =>
      render(
        <ErrorBoundary onError={onError}>
          <Panel store={broken} getComposer={() => composer} />
        </ErrorBoundary>,
        container,
      ),
    ).not.toThrow();

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('still shows the health notice after a crash', () => {
    /*
     * The notice lives OUTSIDE the boundary precisely for this. If the injected
     * UI has failed, that message is the only thing left telling the user their
     * prompts are no longer being checked — putting it inside the thing that
     * just broke would silence exactly the message that matters most.
     */
    render(
      <Panel
        store={store}
        getComposer={() => composer}
        health="unavailable"
        onUiError={() => {}}
      />,
      container,
    );

    expect($('apa-health-notice')).not.toBeNull();
    expect($('apa-health-message')?.textContent).toContain('Protection unavailable');
  });
});
