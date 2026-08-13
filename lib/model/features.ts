import { getCapability } from './capability';
import type { ModelCapability } from './types';

/**
 * Feature availability derived from hardware, not from settings.
 *
 * A user can turn a model feature *off*; they cannot turn one *on* that their
 * machine cannot run. Keeping those two ideas separate is what stops the
 * options page offering a toggle that would silently do nothing — the failure
 * this project has now found three times in other forms.
 */

export interface ModelFeatures {
  /** The underlying capability, for UI that needs the detail. */
  capability: ModelCapability;
  /**
   * Whether to show model-backed controls at all.
   *
   * False means hide, not disable. A disabled control that can never be
   * enabled is an unanswered question in the interface; an absent one is
   * simply a smaller product on that machine.
   */
  showModelFeatures: boolean;
  /** Whether a prompt would run right now, without further setup. */
  canRunNow: boolean;
  /** Whether the user must download the model before these features work. */
  needsDownload: boolean;
  /**
   * Plain-language explanation, or null when everything is fine.
   *
   * Written for someone who does not know what an on-device model is and
   * should not have to.
   */
  explanation: string | null;
}

const UNAVAILABLE: ModelFeatures = {
  capability: { availability: 'unavailable', ready: false, possible: false },
  showModelFeatures: false,
  canRunNow: false,
  needsDownload: false,
  explanation:
    'Prompt improvement needs an on-device AI model, which this browser does not ' +
    'provide. Everything else works normally: secrets are still detected and redacted.',
};

/**
 * Resolves what the model can currently do for this user.
 *
 * Never throws. On any unexpected failure it reports the unavailable state,
 * because the safe direction is a smaller product rather than a broken one.
 */
export async function getModelFeatures(): Promise<ModelFeatures> {
  try {
    const capability = await getCapability();

    if (!capability.possible) return UNAVAILABLE;

    if (capability.ready) {
      return {
        capability,
        showModelFeatures: true,
        canRunNow: true,
        needsDownload: false,
        explanation: null,
      };
    }

    if (capability.availability === 'downloading') {
      return {
        capability,
        showModelFeatures: true,
        canRunNow: false,
        needsDownload: false,
        explanation: 'The on-device model is downloading. This only happens once.',
      };
    }

    return {
      capability,
      showModelFeatures: true,
      canRunNow: false,
      needsDownload: true,
      explanation:
        'Prompt improvement needs a one-time model download. Nothing is sent anywhere ' +
        'either way — the model runs on this device.',
    };
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Whether redaction works. Always true.
 *
 * Exists as an executable statement of the product's central commitment:
 * detection and redaction depend on nothing but the detector, which is pure
 * and has no model, network, or storage dependency. If this function ever
 * needs to consult anything, the layering has been broken.
 */
export function isProtectionAvailable(): true {
  return true;
}
