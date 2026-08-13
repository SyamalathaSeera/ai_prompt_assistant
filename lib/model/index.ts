/**
 * On-device model layer.
 *
 * The single door between this extension and Chrome's built-in Prompt API.
 * Nothing outside `lib/model/` references `LanguageModel`, which is what makes
 * the whole capability removable: if the API disappears, or the user is on
 * Firefox, or the hardware cannot run it, every consumer sees the same
 * `unavailable` answer and simply offers less.
 *
 * ADR-007: inference happens on the device. No backend, no API keys, no
 * per-user cost — and "nothing you type leaves this device" stays literally
 * true rather than needing careful qualification.
 */

export { getAvailability, getCapability, isModelPossible } from './capability';
export { getModelFeatures, isProtectionAvailable } from './features';
export { destroySession, ensureSession, hasSession, run } from './session';
export type { ModelFeatures } from './features';
export type {
  DownloadProgress,
  ModelAvailability,
  ModelCapability,
  ModelFailure,
  ModelResult,
  RunOptions,
} from './types';
