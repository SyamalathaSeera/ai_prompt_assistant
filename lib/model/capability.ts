import type { ModelAvailability, ModelCapability } from './types';

/**
 * Capability detection for Chrome's built-in Prompt API.
 *
 * Answers "can we use a model right now" cheaply and honestly. Every consumer
 * asks this before offering a model-backed feature, so that a machine which
 * cannot run one simply does not see those controls — rather than seeing them
 * fail.
 *
 * Verified on the live browser 2026-08-13: `window.LanguageModel` exists with
 * static `availability()` and `create()`, and reported `"downloadable"`.
 */

/**
 * The API has shipped under more than one name, and users are spread across
 * Chrome versions. Probing both costs nothing and avoids the feature silently
 * disappearing for anyone on an older build.
 */
interface LanguageModelLike {
  availability?: () => Promise<string>;
  capabilities?: () => Promise<{ available?: string }>;
  create?: (options?: unknown) => Promise<unknown>;
}

export function getLanguageModel(): LanguageModelLike | null {
  const global = globalThis as Record<string, unknown>;

  const current = global.LanguageModel as LanguageModelLike | undefined;
  if (current?.create) return current;

  // Older surface: self.ai.languageModel
  const ai = global.ai as { languageModel?: LanguageModelLike } | undefined;
  if (ai?.languageModel?.create) return ai.languageModel;

  return null;
}

/** Normalises the several strings these APIs have used into our own states. */
function normalise(raw: string | undefined): ModelAvailability {
  switch (raw) {
    // `readily` was the older spelling of the same state.
    case 'available':
    case 'readily':
      return 'available';
    case 'downloadable':
    case 'after-download':
      return 'downloadable';
    case 'downloading':
      return 'downloading';
    default:
      return 'unavailable';
  }
}

/**
 * Reads current availability.
 *
 * Never throws and never caches: a model can finish downloading mid-session,
 * and a stale `unavailable` would hide the feature for the rest of the
 * browsing session with no way to recover short of a reload.
 */
export async function getAvailability(): Promise<ModelAvailability> {
  const model = getLanguageModel();
  if (!model) return 'unavailable';

  try {
    if (typeof model.availability === 'function') {
      return normalise(await model.availability());
    }
    if (typeof model.capabilities === 'function') {
      return normalise((await model.capabilities()).available);
    }
  } catch {
    // A probe that throws is treated as unavailable. This is the expected path
    // on Firefox and on Chrome builds without the API.
  }

  return 'unavailable';
}

/** Availability plus the two questions consumers actually ask. */
export async function getCapability(): Promise<ModelCapability> {
  const availability = await getAvailability();

  return {
    availability,
    // Ready means a prompt would run now, with no further setup.
    ready: availability === 'available',
    // Possible means the feature belongs on this machine at all — the
    // difference between "turn this on" and hiding the control entirely.
    possible: availability !== 'unavailable',
  };
}

/**
 * Whether model-backed features should appear in the UI at all.
 *
 * Deliberately distinct from `ready`. A control that says "download the model
 * to use this" is useful; a control that is present but permanently broken is
 * not.
 */
export async function isModelPossible(): Promise<boolean> {
  return (await getCapability()).possible;
}
