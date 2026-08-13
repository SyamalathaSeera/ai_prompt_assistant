/**
 * On-device model types.
 *
 * The extension talks to Chrome's built-in Prompt API through this layer and
 * never touches `LanguageModel` directly, so the whole capability can be
 * absent without any consumer knowing how it would have worked.
 */

/**
 * Whether a model can be used, and what it would cost to start.
 *
 * `downloadable` is the state that matters most: the API works, but first use
 * pulls a large model. That is a decision for the user, not a side effect of
 * opening a settings page.
 */
export type ModelAvailability =
  /** No API, wrong browser, or hardware that cannot run it. */
  | 'unavailable'
  /** Usable, but the model must be downloaded first. */
  | 'downloadable'
  /** Download in progress. */
  | 'downloading'
  /** Ready to use immediately. */
  | 'available';

export interface ModelCapability {
  availability: ModelAvailability;
  /** True only when a prompt would run without further setup. */
  ready: boolean;
  /** True when the feature could work here, given a download. */
  possible: boolean;
}

/**
 * Result of a model call.
 *
 * A discriminated union rather than a thrown error, because failure here is a
 * normal outcome — no model, a timeout, an aborted request when the user kept
 * typing — and callers must be forced to handle it. An exception would let a
 * caller forget, and the failure mode would be a broken UI on exactly the
 * machines least able to run the feature.
 */
export type ModelResult =
  | { ok: true; text: string }
  | { ok: false; reason: ModelFailure; message: string };

export type ModelFailure =
  /** No usable model on this machine. */
  | 'unavailable'
  /** The model exists but has not been downloaded. */
  | 'not-downloaded'
  /** Took longer than the caller's budget. */
  | 'timeout'
  /** Caller cancelled, usually because the draft changed. */
  | 'aborted'
  /** Input exceeds what the model can accept. */
  | 'too-long'
  /** Anything else, including a model that returned nothing usable. */
  | 'failed';

export interface DownloadProgress {
  /** 0 to 1. */
  loaded: number;
}

export interface RunOptions {
  /** Abort the call — used when the composer changes underneath us. */
  signal?: AbortSignal;
  /** Hard limit in milliseconds. */
  timeoutMs?: number;
}
