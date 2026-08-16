import { FALLBACK_STRATEGY_NAMES } from '../adapters/heuristic';
import type { AdapterHealth, SiteAdapter } from '../adapters/types';

/**
 * Is this page actually protected?
 *
 * The failure this milestone exists to prevent: ChatGPT ships a DOM change, the
 * extension silently stops intercepting, and the user keeps typing secrets into
 * a box they believe is being watched. An extension that has stopped working
 * while still *looking* installed is worse than no extension at all — it has
 * replaced a healthy caution with a false sense of safety.
 *
 * So health is a first-class, observable thing rather than a debugging aid, and
 * the only honest states are the three below. Everything here stays local:
 * nothing about a page's health is transmitted, because nothing in this product
 * is.
 */

export type HealthLevel =
  /** Resolved through a named, platform-specific strategy. Working as designed. */
  | 'healthy'
  /**
   * Working, but only via the heuristic fallback.
   *
   * Its own state rather than a flavour of healthy. The heuristics find *a*
   * composer; they do not know it is *the* composer, and the host page has
   * clearly changed underneath us. The user is protected and should be told the
   * ground has moved.
   */
  | 'degraded'
  /** Nothing usable found. The user is NOT protected and must be told plainly. */
  | 'unavailable';

export interface HealthReport {
  level: HealthLevel;
  /** Which strategy resolved the composer, for diagnosis. Never transmitted. */
  resolvedVia: string | null;
  composerFound: boolean;
  submitListenersAttached: boolean;
  /** How many checks have run, including this one. */
  attempts: number;
}

const FALLBACK_NAMES = new Set(FALLBACK_STRATEGY_NAMES);

/**
 * Whether a resolution came from a fallback rather than a named platform hook.
 *
 * Covers the generic tail of every adapter's chain, not just the two shared
 * heuristics — `largest-editable` and `visible-textarea` describe a shape, not
 * a platform, and treating them as a healthy resolution is what let a live page
 * report full protection while sitting on a guess.
 */
export function isFallback(resolvedVia: string | null): boolean {
  return resolvedVia !== null && FALLBACK_NAMES.has(resolvedVia);
}

/** Turns a raw adapter self-check into a level. */
export function levelFor(health: AdapterHealth): HealthLevel {
  if (!health.composerFound) return 'unavailable';

  /*
   * Listeners matter as much as the composer.
   *
   * A composer we can read but a submit path we cannot intercept is the exact
   * shape of the silent failure: the badge would light up, the scan would run,
   * and the prompt would leave anyway. Reporting that as healthy would be a lie
   * with consequences.
   */
  if (!health.submitListenersAttached) return 'unavailable';

  return isFallback(health.resolvedVia) ? 'degraded' : 'healthy';
}

/**
 * Delays before each RETRY, in milliseconds.
 *
 * The first check is not in this list because it does not wait: a monitor that
 * reported nothing until the next tick would leave the UI briefly showing a
 * state nobody had measured, and on injection the answer is wanted now.
 *
 * Front-loaded because the overwhelmingly common cause of a failed first check
 * is not breakage at all — it is arriving before the page has rendered its
 * composer, or during an SPA route change. Those resolve in well under a
 * second, so the early retries are cheap and almost always sufficient.
 *
 * The long tail exists for the case that actually matters: a genuine DOM
 * change, where retrying forever would burn the user's battery to no purpose.
 * After the last entry the monitor stops polling and waits for `recheck`.
 */
export const BACKOFF_MS: readonly number[] = [150, 400, 1000, 2500, 6000];

export interface HealthMonitorConfig {
  adapter: Pick<SiteAdapter, 'checkHealth'>;
  /** Called whenever the level changes. Never called with the same level twice. */
  onChange: (report: HealthReport) => void;
  /** Overridable for tests. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  backoff?: readonly number[];
}

export interface HealthMonitor {
  get(): HealthReport;
  /**
   * Re-checks now, resetting the backoff.
   *
   * Called when something suggests the page has changed underneath us — an SPA
   * navigation, or a mutation after we had given up.
   */
  recheck(): void;
  stop(): void;
}

const UNKNOWN: HealthReport = {
  level: 'unavailable',
  resolvedVia: null,
  composerFound: false,
  submitListenersAttached: false,
  attempts: 0,
};

/**
 * Watches whether an adapter can still do its job.
 *
 * Retries on the backoff schedule until it reaches `healthy`, then stops
 * polling — a working page costs nothing to keep working. `degraded` keeps
 * retrying, because the named selectors may come back when the page finishes
 * rendering, and recovering from degraded to healthy is worth the few extra
 * checks.
 */
export function createHealthMonitor(config: HealthMonitorConfig): HealthMonitor {
  const backoff = config.backoff ?? BACKOFF_MS;
  const schedule = config.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = config.cancel ?? ((handle) => clearTimeout(handle as never));

  let report: HealthReport = UNKNOWN;
  let attempts = 0;
  let step = 0;
  let timer: unknown = null;
  let stopped = false;

  const check = () => {
    if (stopped) return;
    attempts += 1;

    /*
     * A self-check that throws is itself a failure signal.
     *
     * The adapter is reaching into a host page that may have changed in ways
     * it does not expect. Letting that propagate would take down whatever
     * called us; treating it as `unavailable` is both true and useful.
     */
    let health: AdapterHealth;
    try {
      health = config.adapter.checkHealth();
    } catch {
      health = {
        composerFound: false,
        submitListenersAttached: false,
        resolvedVia: null,
      };
    }

    const next: HealthReport = {
      level: levelFor(health),
      resolvedVia: health.resolvedVia,
      composerFound: health.composerFound,
      submitListenersAttached: health.submitListenersAttached,
      attempts,
    };

    const changed = next.level !== report.level || attempts === 1;
    report = next;

    if (changed) {
      try {
        config.onChange(next);
      } catch {
        /* a listener that throws must not stop the monitor watching */
      }
    }

    // Settled. Stop burning timers on a page that is working correctly.
    if (next.level === 'healthy') return;

    // Exhausted: stop polling and wait for `recheck`. Retrying forever would
    // cost battery for a page that is not going to fix itself.
    if (step >= backoff.length) return;

    timer = schedule(check, backoff[step]!);
    step += 1;
  };

  /** Checks now, then schedules retries. The first answer never waits. */
  const start = () => {
    step = 0;
    if (timer !== null) cancel(timer);
    timer = null;
    check();
  };

  start();

  return {
    get: () => report,

    recheck() {
      if (stopped) return;
      start();
    },

    stop() {
      stopped = true;
      if (timer !== null) cancel(timer);
      timer = null;
    },
  };
}
