import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { Panel } from './Panel';
import { createPanelStore } from './panel-store';
import { createRiskStore, type RiskStore } from './risk-store';
import { detect } from '@/lib/detector/engine';
import { ALL_RULES } from '@/lib/detector/rules';

/**
 * What the injected UI costs the host page while it is idle.
 *
 * The complaint that produced this file was "the browser feels slow", and the
 * cause was not detection — that has its own budget and meets it. It was the
 * anchor: two surfaces each ran their own `MutationObserver` over
 * `document.body` with `subtree: true`, on a page that writes a streaming
 * reply into the DOM token by token. Every batch of mutations scheduled a
 * `querySelector` and a `getBoundingClientRect`, and a `getBoundingClientRect`
 * forces synchronous layout on the page we are guests of.
 *
 * These tests count the forced layouts rather than timing them. A timing
 * assertion on a busy CI box measures the box; a call count measures the bug.
 */

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';

let container: HTMLElement;
let composer: HTMLElement;
let riskStore: RiskStore;
let measurements: number;

/** Counts every forced layout the extension causes, from any surface. */
function countingRect(el: HTMLElement): void {
  el.getBoundingClientRect = () => {
    measurements += 1;
    return {
      top: 500,
      left: 200,
      right: 900,
      bottom: 560,
      width: 700,
      height: 60,
    } as DOMRect;
  };
}

/** One batch of DOM churn, as a streaming reply produces continuously. */
function streamTokens(count: number): void {
  const log = document.getElementById('chat-log')!;
  for (let i = 0; i < count; i += 1) {
    log.appendChild(document.createTextNode('token '));
  }
}

/**
 * Lets pending MutationObserver callbacks and rAF work run.
 *
 * Comfortably longer than a frame and comfortably shorter than the mutation
 * throttle. A shorter wait made these tests pass against the unthrottled code
 * too, because the measurement they were meant to catch had not happened yet.
 */
const FRAME_MS = 50;
const settle = () => new Promise((resolve) => setTimeout(resolve, FRAME_MS));

beforeEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  measurements = 0;

  container = document.createElement('div');
  document.body.appendChild(container);

  const log = document.createElement('div');
  log.id = 'chat-log';
  document.body.appendChild(log);

  composer = document.createElement('div');
  document.body.appendChild(composer);
  countingRect(composer);

  riskStore = createRiskStore();

  render(
    <Panel
      store={createPanelStore()}
      riskStore={riskStore}
      getComposer={() => composer}
    />,
    container,
  );
});

afterEach(() => {
  render(null, container);
  document.body.innerHTML = '';
});

describe('the cost of following the composer', () => {
  it('measures the composer once, not once per surface', async () => {
    /*
     * Two surfaces are anchored to the same element. They used to measure it
     * separately, which doubled every observer, every listener, and every
     * forced layout for no benefit at all.
     */
    const text = `AWS_ACCESS_KEY_ID=${AWS_KEY}`;
    riskStore.setRisk('high', detect(text, {}, ALL_RULES), text);
    await settle();

    const baseline = measurements;
    measurements = 0;

    streamTokens(200);
    await settle();

    // A single shared anchor means a single measure per burst. Two would mean
    // two, and the old code took one per surface per animation frame.
    expect(measurements).toBeLessThanOrEqual(1);
    expect(baseline).toBeGreaterThan(0); // the harness is actually wired up
  });

  it('does not re-measure on every mutation of a streaming reply', async () => {
    /*
     * The heart of it. Several separate bursts, as a reply arrives over
     * seconds, must not each force a layout — the throttle in `useAnchor`
     * collapses them, because the only thing the mutation path still has to
     * notice is the composer being replaced.
     */
    const BURSTS = 5;
    measurements = 0;

    for (let burst = 0; burst < BURSTS; burst += 1) {
      streamTokens(100);
      await settle();
    }

    /*
     * The guarantee is a rate, not a single measurement: one leading measure,
     * then at most one more per throttle interval. Five bursts across roughly
     * 250ms therefore allows two. Without the throttle this is five — one per
     * burst — which is what the number here is really asserting against.
     */
    const allowed = 1 + Math.ceil((BURSTS * FRAME_MS) / 500);
    expect(measurements).toBeLessThanOrEqual(allowed);
    expect(measurements).toBeLessThan(BURSTS);
  });

  it('still notices when the composer is replaced', async () => {
    // The throttle must not become a way of never looking again. This is the
    // one job the mutation path still has.
    const replacement = document.createElement('div');
    let measured = false;
    replacement.getBoundingClientRect = () => {
      measured = true;
      return { top: 100, left: 10, right: 700, bottom: 160, width: 690, height: 60 } as DOMRect;
    };

    composer.remove();
    document.body.appendChild(replacement);
    composer = replacement;

    await vi.waitFor(() => expect(measured).toBe(true), { timeout: 3000 });
  });
});
