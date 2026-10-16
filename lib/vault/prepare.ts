import { redact } from '../detector/engine';
import type { Finding } from '../detector/types';
import { persistRedaction } from './index';

/** Use the reviewed findings, not a second scan with different settings or numbering. */
export async function prepareRedaction(
  original: string,
  replacement: string,
  findings: readonly Finding[],
  conversationId: string,
  retain = true,
): Promise<string> {
  const { map } = redact(original, findings);
  return persistRedaction(replacement, map, conversationId, retain);
}
