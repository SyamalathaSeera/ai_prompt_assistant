import { getAvailability, getLanguageModel, MODEL_OPTIONS } from './capability';
import type { DownloadProgress, ModelResult, RunOptions } from './types';

/**
 * Model session lifecycle and prompt execution.
 *
 * One session is created lazily, reused, and destroyed when idle. Sessions
 * hold memory proportional to their context window, and creating one per
 * request would be both slow and wasteful on the modest hardware this feature
 * is most likely to run on.
 */

/** Default hard limit for a single call. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Destroy the session after this long without use.
 *
 * The model is a background cost the user did not ask to keep paying. Ten
 * minutes covers a working session; beyond that, holding it is rude.
 */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

interface Session {
  prompt: (input: string, options?: { signal?: AbortSignal }) => Promise<string>;
  destroy: () => void;
  measureContextUsage?: (input: string) => Promise<number>;
  contextWindow?: number;
}

let session: Session | null = null;
let creating: Promise<Session | null> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function touchIdleTimer(): void {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => destroySession(), IDLE_TIMEOUT_MS);
}

/** Destroys the current session, if any. Safe to call at any time. */
export function destroySession(): void {
  if (idleTimer !== undefined) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }

  try {
    session?.destroy();
  } catch {
    /* a session that cannot be destroyed is already gone */
  }
  session = null;
}

/**
 * Creates the model session, downloading the model if necessary.
 *
 * **Only ever called from an explicit user action.** The first call can pull
 * hundreds of megabytes; doing that because someone opened a settings page, or
 * typed into a composer, would be a hostile surprise on a metered connection.
 * `onProgress` exists so the UI can show what it is costing them.
 */
export async function ensureSession(
  onProgress?: (progress: DownloadProgress) => void,
): Promise<Session | null> {
  if (session) {
    touchIdleTimer();
    return session;
  }

  // Concurrent callers share one creation rather than racing to download twice.
  if (creating) return creating;

  const model = getLanguageModel();
  // Captured rather than re-read: narrowing does not survive into the async
  // closure below, and the property is on an object we do not own.
  const create = model?.create;
  if (!create) return null;

  creating = (async () => {
    try {
      const created = (await create.call(model, {
        // Same options the availability probe used. See MODEL_OPTIONS.
        ...MODEL_OPTIONS,
        monitor: (monitor: EventTarget) => {
          monitor.addEventListener('downloadprogress', (event: Event) => {
            const { loaded } = event as Event & { loaded?: number };
            if (typeof loaded === 'number') onProgress?.({ loaded });
          });
        },
      })) as Session;

      session = created;
      touchIdleTimer();
      return created;
    } catch {
      // Download declined, hardware unable, or storage full. All the same to
      // the caller: no model.
      return null;
    } finally {
      creating = null;
    }
  })();

  return creating;
}

/** Whether a session is currently alive. Used by tests and diagnostics. */
export function hasSession(): boolean {
  return session !== null;
}

/**
 * Builds the session ahead of time, if one can be built for free.
 *
 * Every refinement measured on the real model carried roughly three seconds of
 * cost before the first word appeared, and part of that is constructing the
 * session. It is the same work either way — this just moves it off the moment
 * the user is sitting watching a spinner, to the moment they showed they were
 * about to ask.
 *
 * **Never downloads.** `ensureSession` calls `create()`, and `create()` will
 * happily pull hundreds of megabytes if the model is not there yet — so this
 * checks availability first and does nothing at all unless the answer is
 * `available`. A hover must not cost someone their data allowance.
 *
 * Silent by design: it returns nothing and reports nothing. A warm-up that
 * failed changes only how long the next refinement takes, and `run()` will
 * build the session itself when the time comes.
 */
export async function warmSession(): Promise<void> {
  if (session || creating) return;
  if ((await getAvailability()) !== 'available') return;

  await ensureSession();
}

/**
 * Runs one prompt.
 *
 * Returns a result rather than throwing, so callers are forced to handle
 * failure — which is a normal outcome here, not an exception.
 *
 * Three guards, each earned:
 *
 *  - **Timeout.** An on-device model on a busy machine can take seconds, and
 *    the user is mid-task. Without a hard limit, a slow call becomes a hung
 *    feature.
 *  - **Abort.** A suggestion for text the user has already rewritten is worse
 *    than no suggestion, so callers cancel when the composer changes.
 *  - **Length.** Refuse rather than truncate. A silently truncated prompt
 *    produces a confidently wrong rewrite, and the user has no way to tell.
 */
export async function run(prompt: string, options: RunOptions = {}): Promise<ModelResult> {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  if (signal?.aborted) {
    return { ok: false, reason: 'aborted', message: 'Cancelled before starting.' };
  }

  const availability = await getAvailability();
  if (availability === 'unavailable') {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'No on-device model is available in this browser.',
    };
  }
  if (availability !== 'available') {
    // Deliberately does NOT start the download. That is the caller's decision
    // to offer, not something a prompt quietly triggers.
    return {
      ok: false,
      reason: 'not-downloaded',
      message: 'The on-device model has not been downloaded yet.',
    };
  }

  const active = await ensureSession();
  if (!active) {
    return { ok: false, reason: 'unavailable', message: 'Could not start the model.' };
  }

  // Length check against the model's real context window, when it exposes one.
  // Character heuristics guess wrong in both directions.
  try {
    if (active.measureContextUsage && active.contextWindow) {
      const usage = await active.measureContextUsage(prompt);
      if (usage > active.contextWindow) {
        return {
          ok: false,
          reason: 'too-long',
          message: 'This prompt is too long for the on-device model.',
        };
      }
    }
  } catch {
    /* measurement is an optimisation; its absence is not a failure */
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller);

  /*
   * Re-check after wiring the listener, and return WITHOUT calling the model.
   *
   * Everything above this point is asynchronous — the availability probe and
   * session creation both await — so the caller can abort during that window.
   * `addEventListener('abort')` on an already-aborted signal never fires, so
   * the abort would otherwise be lost and the call would hang until its
   * timeout instead of returning at once.
   *
   * Returning here rather than merely aborting the controller matters: passing
   * an already-aborted signal to `prompt()` relies on the implementation
   * checking it eagerly, and one that only subscribes to the abort event would
   * never settle. Not starting work that is already cancelled is both correct
   * and independent of that detail.
   *
   * Found by a test that timed out instead of reporting `aborted`.
   */
  if (signal?.aborted) {
    signal.removeEventListener('abort', abortFromCaller);
    return { ok: false, reason: 'aborted', message: 'Cancelled.' };
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const text = await active.prompt(prompt, { signal: controller.signal });
    touchIdleTimer();

    const trimmed = text.trim();
    if (trimmed === '') {
      return { ok: false, reason: 'failed', message: 'The model returned nothing.' };
    }

    return { ok: true, text: trimmed };
  } catch {
    // Distinguish who cancelled: the caller changing their mind is not the
    // same event as our own deadline expiring, and the UI says different
    // things about each.
    if (signal?.aborted) {
      return { ok: false, reason: 'aborted', message: 'Cancelled.' };
    }
    if (controller.signal.aborted) {
      return { ok: false, reason: 'timeout', message: 'The model took too long.' };
    }
    return { ok: false, reason: 'failed', message: 'The model could not respond.' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

/** Resets module state. Test seam only. */
export function __resetForTests(): void {
  destroySession();
  creating = null;
}
