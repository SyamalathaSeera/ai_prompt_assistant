import { describe, expect, it, vi } from 'vitest';
import { createHealthMonitor, isFallback, levelFor } from './index';
import type { HealthReport } from './index';
import type { AdapterHealth } from '../adapters/types';

/**
 * Health reporting.
 *
 * The property under test throughout: the extension must never report itself
 * as working when it is not. A false "protected" is worse than an obvious
 * failure, because it replaces healthy caution with a false sense of safety.
 */

const health = (over: Partial<AdapterHealth> = {}): AdapterHealth => ({
  composerFound: true,
  submitListenersAttached: true,
  resolvedVia: 'id',
  ...over,
});

/** Runs the monitor synchronously by making every scheduled step immediate. */
function immediate() {
  const queue: (() => void)[] = [];
  return {
    schedule: (fn: () => void) => {
      queue.push(fn);
      return queue.length;
    },
    cancel: () => {},
    /** Drains the queue, up to a bound so a bug cannot hang the suite. */
    drain(max = 50) {
      let count = 0;
      while (queue.length > 0 && count < max) {
        queue.shift()?.();
        count += 1;
      }
    },
  };
}

describe('grading a self-check', () => {
  it('is healthy when a named selector resolved', () => {
    expect(levelFor(health({ resolvedVia: 'id' }))).toBe('healthy');
  });

  it('is degraded when only a heuristic resolved', () => {
    // Its own state, not a flavour of healthy: the heuristics find *a*
    // composer, not necessarily *the* composer, and the page has clearly moved.
    expect(levelFor(health({ resolvedVia: 'focused-editable' }))).toBe('degraded');
    expect(levelFor(health({ resolvedVia: 'editable-near-submit' }))).toBe('degraded');
  });

  it('is degraded when a generic fallback resolved', () => {
    /*
     * Observed live on chatgpt.com: one second after injection the ProseMirror
     * composer had not rendered, the chain fell through to `visible-textarea`,
     * and health reported **healthy** — then stopped polling, because a healthy
     * page is not re-checked. The extension sat on a guess and called it fine,
     * which is precisely the silent failure this module exists to prevent.
     *
     * These two name a shape, not a platform. They are fallbacks in everything
     * but where they sit in the adapter file.
     */
    expect(levelFor(health({ resolvedVia: 'visible-textarea' }))).toBe('degraded');
    expect(levelFor(health({ resolvedVia: 'largest-editable' }))).toBe('degraded');
  });

  it('upgrades itself once the real composer arrives', () => {
    // The half of the fix that matters most. Grading a fallback as degraded
    // keeps the monitor polling, so a slow-rendering page recovers to healthy
    // on its own instead of being stuck on whatever existed at second one.
    const clock = immediate();
    const seen: HealthReport[] = [];
    let via = 'visible-textarea';

    createHealthMonitor({
      adapter: { checkHealth: () => health({ resolvedVia: via }) },
      onChange: (report) => seen.push(report),
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    expect(seen.at(-1)?.level).toBe('degraded');

    via = 'id';
    clock.drain();

    expect(seen.at(-1)?.level).toBe('healthy');
  });

  it('is unavailable when no composer was found', () => {
    expect(levelFor(health({ composerFound: false }))).toBe('unavailable');
  });

  it('is unavailable when the submit path cannot be intercepted', () => {
    /*
     * The exact shape of a silent failure: a composer we can read but a
     * submission we cannot hold. The badge would light up, the scan would run,
     * and the prompt would leave anyway.
     */
    expect(levelFor(health({ submitListenersAttached: false }))).toBe('unavailable');
  });

  it('knows which strategy names are fallbacks', () => {
    expect(isFallback('focused-editable')).toBe(true);
    expect(isFallback('visible-textarea')).toBe(true);
    expect(isFallback('largest-editable')).toBe(true);

    // Platform-specific hooks. Resolving through one of these is the tool
    // working as designed, not recovering from a change.
    expect(isFallback('id')).toBe(false);
    expect(isFallback('role-textbox')).toBe(false);
    expect(isFallback('prosemirror')).toBe(false);
    expect(isFallback(null)).toBe(false);
  });
});

describe('retrying before giving up', () => {
  it('recovers when the composer appears late', () => {
    /*
     * By far the most common reason a first check fails: we arrived before the
     * page rendered, or during an SPA route change. Treating that as breakage
     * would show "protection unavailable" on nearly every page load.
     */
    const clock = immediate();
    let ready = false;
    const seen: HealthReport[] = [];

    createHealthMonitor({
      adapter: { checkHealth: () => health({ composerFound: ready }) },
      onChange: (report) => seen.push(report),
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    // First check fails.
    expect(seen.at(-1)?.level).toBe('unavailable');

    ready = true;
    clock.drain();

    expect(seen.at(-1)?.level).toBe('healthy');
  });

  it('stops polling once healthy', () => {
    const clock = immediate();
    const checkHealth = vi.fn(() => health());

    createHealthMonitor({
      adapter: { checkHealth },
      onChange: () => {},
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    clock.drain();

    // A page that works costs nothing to keep working.
    expect(checkHealth).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying while degraded, in case the real selectors come back', () => {
    const clock = immediate();
    const checkHealth = vi.fn(() => health({ resolvedVia: 'focused-editable' }));

    createHealthMonitor({
      adapter: { checkHealth },
      onChange: () => {},
      schedule: clock.schedule,
      cancel: clock.cancel,
      backoff: [0, 1, 2],
    });

    clock.drain();

    expect(checkHealth.mock.calls.length).toBeGreaterThan(1);
  });

  it('gives up after the schedule rather than retrying forever', () => {
    // Retrying forever would burn battery on a page that is not going to fix
    // itself. `recheck` is how it wakes up again.
    const clock = immediate();
    const checkHealth = vi.fn(() => health({ composerFound: false }));

    createHealthMonitor({
      adapter: { checkHealth },
      onChange: () => {},
      schedule: clock.schedule,
      cancel: clock.cancel,
      backoff: [1, 2],
    });

    clock.drain();

    // One immediate check, then one per backoff entry.
    expect(checkHealth).toHaveBeenCalledTimes(3);
  });

  it('starts again on recheck', () => {
    const clock = immediate();
    const checkHealth = vi.fn(() => health({ composerFound: false }));

    const monitor = createHealthMonitor({
      adapter: { checkHealth },
      onChange: () => {},
      schedule: clock.schedule,
      cancel: clock.cancel,
      backoff: [1],
    });

    clock.drain();
    const before = checkHealth.mock.calls.length;

    monitor.recheck();
    clock.drain();

    expect(checkHealth.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('reporting changes', () => {
  it('reports the first result even when it is bad', () => {
    // Total failure has to surface. Reporting only *changes* would leave a
    // page that was broken from the first moment silently unreported.
    const clock = immediate();
    const seen: HealthReport[] = [];

    createHealthMonitor({
      adapter: { checkHealth: () => health({ composerFound: false }) },
      onChange: (report) => seen.push(report),
      schedule: clock.schedule,
      cancel: clock.cancel,
      backoff: [],
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.level).toBe('unavailable');
  });

  it('does not repeat the same level', () => {
    const clock = immediate();
    const seen: HealthReport[] = [];

    createHealthMonitor({
      adapter: { checkHealth: () => health({ composerFound: false }) },
      onChange: (report) => seen.push(report),
      schedule: clock.schedule,
      cancel: clock.cancel,
      backoff: [1, 2, 3],
    });

    clock.drain();

    expect(seen).toHaveLength(1);
  });

  it('carries the resolving strategy for diagnosis', () => {
    const clock = immediate();
    const seen: HealthReport[] = [];

    createHealthMonitor({
      adapter: { checkHealth: () => health({ resolvedVia: 'role-textbox' }) },
      onChange: (report) => seen.push(report),
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    expect(seen[0]?.resolvedVia).toBe('role-textbox');
  });
});

describe('failing safely', () => {
  it('treats a self-check that throws as unavailable', () => {
    /*
     * The adapter reaches into a host page that may have changed in ways it
     * does not expect. Letting that propagate would take down the caller;
     * calling it unavailable is both true and useful.
     */
    const clock = immediate();
    const seen: HealthReport[] = [];

    createHealthMonitor({
      adapter: {
        checkHealth: () => {
          throw new Error('DOM changed underneath us');
        },
      },
      onChange: (report) => seen.push(report),
      schedule: clock.schedule,
      cancel: clock.cancel,
      backoff: [],
    });

    expect(seen[0]?.level).toBe('unavailable');
  });

  it('keeps watching when a listener throws', () => {
    const clock = immediate();
    let ready = false;

    const monitor = createHealthMonitor({
      adapter: { checkHealth: () => health({ composerFound: ready }) },
      onChange: () => {
        throw new Error('the UI blew up');
      },
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    ready = true;
    clock.drain();

    expect(monitor.get().level).toBe('healthy');
  });

  it('stops cleanly', () => {
    const clock = immediate();
    const checkHealth = vi.fn(() => health({ composerFound: false }));

    const monitor = createHealthMonitor({
      adapter: { checkHealth },
      onChange: () => {},
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    monitor.stop();
    const after = checkHealth.mock.calls.length;
    clock.drain();

    expect(checkHealth).toHaveBeenCalledTimes(after);
  });
});
