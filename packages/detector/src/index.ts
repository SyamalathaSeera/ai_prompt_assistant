/** Public facade over the extension's unchanged, pure detector sources. */
export {
  detect,
  redact,
  detectAndRedact,
  placeholderPattern,
} from '../../../lib/detector/engine';
export { ALL_RULES } from '../../../lib/detector/rules';
export type {
  Finding,
  DetectOptions,
  Rule,
  RedactionResult,
} from '../../../lib/detector/types';
