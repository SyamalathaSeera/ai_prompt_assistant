/**
 * The refinement instruction.
 *
 * This file is the product. Everything around it is plumbing, and a mediocre
 * instruction here cannot be rescued by good UI.
 *
 * The governing rule is **preserve intent above all else**. A refinement that
 * changes what the user meant is worse than none at all: they will not re-read
 * closely enough to catch it, they will send it, and they will blame the model
 * for answering the wrong question. A rewrite that is merely tidier is a small
 * win; one that is subtly different is a silent loss.
 */

/**
 * Every style the evaluator and the corpus know about.
 *
 * Wider than what is offered: `concise` and `beginner` are retired (see
 * `RETIRED_STYLES`) and appear in no menu, but remain valid values so the
 * graded corpus keeps its meaning and a stored setting never becomes an
 * unrepresentable type.
 */
export type RefinementStyle =
  | 'clear'
  | 'concise'
  | 'detailed'
  | 'technical'
  | 'beginner';

export interface StyleDefinition {
  id: RefinementStyle;
  label: string;
  /** Shown in the picker. Describes the outcome, not the mechanism. */
  description: string;
  /** Appended to the base instruction. */
  instruction: string;
}

/**
 * Styles are distinct instructions, not tone adjectives.
 *
 * "Make it professional" produces padding. Saying what to actually do with the
 * text produces a different result per style, which is the only reason to
 * offer more than one.
 */
export const STYLES: readonly StyleDefinition[] = [
  {
    id: 'clear',
    label: 'Clearer',
    description: 'Fixes vague wording and structure. The safe default.',
    instruction:
      'Make the request unambiguous. Put the task first, then any context. Keep the ' +
      'length similar to the original.',
  },
  {
    id: 'detailed',
    label: 'More specific',
    description: 'Asks for the output format and detail the request implies.',
    /*
     * Says what to do, and does not repeat the restraint.
     *
     * The first version read "spell out what a complete answer should
     * include, and the format it should take, where the original clearly
     * implies these. Do not invent requirements the original does not imply."
     * Two brakes on one accelerator — and the second was already a global
     * rule sent with every single prompt. A small on-device model hears "add
     * detail" once and "add nothing" twice, and settles it by barely editing,
     * which is exactly what this style was reported as doing.
     *
     * Nothing is lost by dropping the duplicate: the global rule still
     * forbids inventing facts, and `inventedSpecifics` in `evaluate.ts`
     * rejects a fabrication mechanically whatever the instruction said. The
     * last clause turns the restraint into an action instead of a
     * prohibition, which is the one shape a small model reliably follows.
     */
    instruction:
      'Spell out what a complete answer must cover and the form it should take, such ' +
      'as the steps, comparisons, or sections the request calls for. Where the request ' +
      'leaves something open, ask for it explicitly rather than leaving it implied.',
  },
  {
    id: 'technical',
    label: 'Technical',
    description: 'Structures it as an engineering request.',
    instruction:
      'Structure as a technical request: state the goal, the relevant context, and the ' +
      'expected output. Use precise terms already present in the original.',
  },
];

/**
 * Styles that are no longer offered.
 *
 * Three names for one setting is a menu someone reads; five is a list they
 * skim past, and "Shorter" and "Explain to me simply" were the two whose jobs
 * a good "Clearer" rewrite largely already does.
 *
 * They are retired rather than deleted because `test/refine-corpus/` grades
 * suggestions **per style**, and those judgements were made against these
 * instructions. Deleting the definitions would leave the corpus quietly
 * grading `clear` output under a `concise` label — the recorded evidence would
 * still pass while no longer meaning anything. Nothing here reaches the UI:
 * `STYLES` is what the picker and the options page render, and `STYLE_IDS` in
 * `policy/migrate.ts` is derived from it, so a user who had one of these
 * stored falls back to the default the next time settings are read.
 */
export const RETIRED_STYLES: readonly StyleDefinition[] = [
  {
    id: 'concise',
    label: 'Shorter',
    description: 'Cuts filler without losing any requirement.',
    instruction:
      'Remove filler, hedging, and repetition. Keep every requirement and constraint ' +
      'the original states. Aim for noticeably fewer words.',
  },
  {
    id: 'beginner',
    label: 'Explain to me simply',
    description: 'Asks for an answer that assumes no prior knowledge.',
    instruction:
      'Rewrite so the answer will assume no prior knowledge, defining terms and ' +
      'avoiding jargon. Keep the same question.',
  },
];

export const DEFAULT_STYLE: RefinementStyle = 'clear';

export function getStyle(id: RefinementStyle): StyleDefinition {
  return (
    STYLES.find((style) => style.id === id) ??
    RETIRED_STYLES.find((style) => style.id === id) ??
    STYLES[0]!
  );
}

/**
 * Marker the model is told to leave untouched.
 *
 * Placeholders are already in the text by the time refinement runs (see
 * `guard.ts`), and a model that helpfully "fixes" `[REDACTED_AWS_KEY_1]` into
 * something prettier would break re-hydration and, worse, make the user think
 * a different value was sent.
 */
export const PLACEHOLDER_RULE =
  'Text in square brackets like [REDACTED_SOMETHING_1] is a placeholder. Copy each one ' +
  'through exactly as it appears. Never alter, translate, remove, or add one.';

/**
 * Builds the full instruction for one refinement.
 *
 * Constraints are stated as prohibitions because they are what goes wrong:
 *
 *  - **No preamble.** Models like to say "Here's an improved version:". That
 *    text would be sent to the chat as part of the prompt.
 *  - **No invented specifics.** If the draft says "the login bug", the
 *    refinement must not name a file the user never mentioned. A confident
 *    fabrication is harder to spot than a vague original.
 *  - **No answering.** The input is a question; the output must remain a
 *    question. A model given a prompt to improve will often answer it instead.
 */
export function buildRefinementPrompt(
  draft: string,
  style: RefinementStyle,
  options: { hasPlaceholders?: boolean } = {},
): string {
  const definition = getStyle(style);

  /*
   * The placeholder rule is only sent when there is a placeholder.
   *
   * It is the longest line here — 156 characters, roughly a fifth of the whole
   * instruction — and on a draft containing no secrets it is a rule about
   * nothing. Every character is prefill the on-device model pays for before it
   * writes a word, on every refinement, on the machine the user is waiting at.
   *
   * Kept unconditionally would be the safer-looking choice and the wrong one:
   * a rule the text cannot violate does not protect anything, and the cost is
   * paid by the majority of drafts, which contain no secrets at all.
   */
  const { hasPlaceholders = true } = options;

  return [
    'You rewrite prompts that a person is about to send to an AI assistant.',
    '',
    'Rules:',
    '- Preserve the original meaning and intent exactly. This matters more than any',
    '  other rule here.',
    '- Do not answer the prompt. Return only the rewritten prompt.',
    '- Do not add facts, names, file paths, numbers, or requirements that are not in',
    '  the original.',
    '- Do not add a preamble, explanation, quotation marks, or markdown fences.',
    ...(hasPlaceholders ? [`- ${PLACEHOLDER_RULE}`] : []),
    `- ${definition.instruction}`,
    '',
    'Rewrite this prompt:',
    '---',
    draft,
    '---',
  ].join('\n');
}

/**
 * Strips the wrappers models add despite being told not to.
 *
 * Instructions reduce this; they do not eliminate it. The output goes straight
 * into someone's message box, so a stray "Here's an improved version:" would be
 * sent to the chat as if they had typed it.
 */
export function cleanResponse(raw: string): string {
  let text = raw.trim();

  // Fenced code block wrapping the whole response.
  const fenced = /^```(?:[a-z]*)?\n([\s\S]*?)\n?```$/i.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1].trim();

  // A leading "Here is the improved prompt:" line, in its common variations.
  text = text.replace(
    /^(?:here(?:'s| is)[^\n:]*:|improved prompt:|rewritten prompt:|revised prompt:)\s*/i,
    '',
  );

  // Surrounding quotes, but only when they wrap the entire response — a
  // prompt may legitimately begin and end with quoted text.
  const quoted = /^"([\s\S]+)"$/.exec(text.trim());
  if (quoted?.[1] !== undefined && !quoted[1].includes('"')) text = quoted[1];

  return text.trim();
}
