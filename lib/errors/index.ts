import { browser } from 'wxt/browser';
import { detect, redact } from '../detector/engine';

/**
 * A local-only error log.
 *
 * Exists so a bug can be reported without the user pasting their prompt into
 * an issue tracker. That is not a convenience — it is the only way a privacy
 * tool can collect diagnostics at all. There is no telemetry in this product
 * and there is not going to be, so the alternative to this file is asking
 * people to describe crashes from memory.
 *
 * Two rules govern everything here:
 *
 *  1. **Never persist prompt content.** Every string is run through the
 *     detector and redacted before it is written, and truncated hard. Rule 3
 *     in CLAUDE.md applies to our own diagnostics exactly as it applies to
 *     logs — a crash report is not an exception.
 *  2. **Never leave the device.** `.local` storage, read only by the options
 *     page. Nothing fetches it, nothing uploads it.
 */

const ERRORS_KEY = 'apa:errors';

/**
 * How many errors to keep.
 *
 * Small. The purpose is "what just went wrong", not a history — and a log that
 * grows without bound is a liability in a product whose pitch is that it does
 * not accumulate your data.
 */
export const MAX_ERRORS = 20;

/**
 * Longest message or stack kept.
 *
 * A blunt second line of defence behind redaction. Some framework errors quote
 * the input that caused them, and a stack frame can carry an inline snippet;
 * truncation bounds how much of anything can survive, whatever it is.
 */
const MAX_CHARS = 600;

export interface LoggedError {
  /** Epoch ms. */
  at: number;
  /** Static label for the pipeline stage, e.g. `ui.approval-modal`. */
  where: string;
  message: string;
  stack: string | null;
}

/**
 * Removes anything the detector recognises, then truncates.
 *
 * Uses the same rules that decide what to redact from a prompt, so the log
 * cannot contain a class of secret the product claims to catch. A secret the
 * detector misses can still reach here in principle — which is why the length
 * cap sits behind it rather than instead of it.
 */
export function scrub(text: string): string {
  if (text === '') return '';

  let safe: string;
  try {
    safe = redact(text, detect(text)).text;
  } catch {
    // A detector failure must not become a reason to write unredacted text.
    return '[unavailable]';
  }

  return safe.length > MAX_CHARS ? `${safe.slice(0, MAX_CHARS)}…` : safe;
}

/** Turns anything thrown into a loggable shape. */
function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      message: scrub(`${error.name}: ${error.message}`),
      stack: error.stack ? scrub(error.stack) : null,
    };
  }

  // Non-Error throws are common in DOM code and often carry page data, so this
  // path gets the same treatment rather than a friendlier one.
  return { message: scrub(String(error)), stack: null };
}

/**
 * Records an error.
 *
 * Best-effort and never throws. A logger that can break the thing it is
 * watching is worse than no logger — this is called from catch blocks whose
 * whole job is to keep the extension out of the user's way.
 */
export async function recordError(where: string, error: unknown): Promise<void> {
  try {
    const { message, stack } = describe(error);

    const entry: LoggedError = {
      at: Date.now(),
      // A caller-supplied label, not page data — but scrubbed anyway, because
      // "callers only pass constants" is a convention and conventions rot.
      where: scrub(where).slice(0, 80),
      message,
      stack,
    };

    const stored = await browser.storage.local.get(ERRORS_KEY);
    const existing = Array.isArray(stored[ERRORS_KEY])
      ? (stored[ERRORS_KEY] as LoggedError[])
      : [];

    // Newest first, oldest dropped.
    await browser.storage.local.set({
      [ERRORS_KEY]: [entry, ...existing].slice(0, MAX_ERRORS),
    });
  } catch {
    /* diagnostics must never become the fault */
  }
}

/** Reads the log, newest first. */
export async function getErrors(): Promise<LoggedError[]> {
  try {
    const stored = await browser.storage.local.get(ERRORS_KEY);
    return Array.isArray(stored[ERRORS_KEY]) ? (stored[ERRORS_KEY] as LoggedError[]) : [];
  } catch {
    return [];
  }
}

/** Empties the log. */
export async function clearErrors(): Promise<void> {
  try {
    await browser.storage.local.remove(ERRORS_KEY);
  } catch {
    /* nothing further we can safely do */
  }
}

/** Formats the log for a bug report. Already redacted; safe to paste. */
export function formatForReport(errors: readonly LoggedError[]): string {
  if (errors.length === 0) return 'No errors recorded.';

  return errors
    .map((error) => {
      const when = new Date(error.at).toISOString();
      const stack = error.stack ? `\n${error.stack}` : '';
      return `[${when}] ${error.where}\n${error.message}${stack}`;
    })
    .join('\n\n');
}
