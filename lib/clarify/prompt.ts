import { PLACEHOLDER_RULE } from '../refine/prompt';
import type { VagueReference } from './references';

/**
 * The clarification instruction.
 *
 * Refinement's instruction says *do not add anything the original does not
 * contain*. This one has to say almost the opposite — resolve the reference,
 * which means adding words the draft never had — while keeping the same
 * guarantee against fabrication. The line it walks is:
 *
 *   **Add nothing that is not already in the conversation.**
 *
 * That is a narrower licence than "be helpful", and it is the only one that
 * makes this feature safe. A resolution taken from the conversation can be
 * checked, shown to the user, and traced back to the turn it came from. A
 * resolution the model reasoned its way to cannot, and it is exactly the kind
 * of confident wrong answer this feature exists to prevent.
 */

/**
 * Builds the instruction for one clarification.
 *
 * Both `contextText` and `draft` must already be redacted — see
 * `context.ts` and `refine/guard.ts`. This function does no redaction of its
 * own and must never be handed raw text.
 *
 * The listed references are included so the model knows which words are in
 * question. Without them a model asked to "resolve vague references" tends to
 * rewrite the whole prompt, which is refinement's job and not this one's.
 */
export function buildClarificationPrompt(
  draft: string,
  contextText: string,
  references: readonly VagueReference[],
): string {
  const quoted = [...new Set(references.map((r) => r.text.trim().toLowerCase()))]
    .map((text) => `"${text}"`)
    .join(', ');

  return [
    'You resolve vague references in a message someone is about to send in an ongoing',
    'conversation with an AI assistant.',
    '',
    'The conversation so far:',
    '---',
    contextText,
    '---',
    '',
    'Rules:',
    '- Replace only the vague references with what they refer to.',
    `- The vague references are: ${quoted}.`,
    '- Use ONLY information that appears in the conversation above. Never introduce a',
    '  name, file, number, or detail that is not written there.',
    '- If the conversation does not make a reference clear, leave that reference exactly',
    '  as it is. Leaving it alone is always better than guessing.',
    '- Change nothing else. Do not improve, shorten, reorder, or restructure the wording.',
    '- Do not answer the message. Return only the rewritten message.',
    '- Do not add a preamble, explanation, quotation marks, or markdown fences.',
    `- ${PLACEHOLDER_RULE}`,
    '',
    'Rewrite this message:',
    '---',
    draft,
    '---',
  ].join('\n');
}
