import type { RefinementStyle } from './prompt';

/**
 * Mechanical quality checks on a suggestion.
 *
 * Prose quality cannot be asserted, and any attempt to score it would be a
 * number that means nothing. What *can* be checked is whether the suggestion
 * broke one of the rules the instruction states — and those are exactly the
 * failures that matter, because each one produces a prompt the user would not
 * have written and might not notice:
 *
 *  - **Preamble.** "Here's an improved version:" would be sent to the chat as
 *    if the user had typed it.
 *  - **Invented specifics.** A file path, version number, or identifier the
 *    user never mentioned sends the assistant confidently in the wrong
 *    direction. A confident fabrication is harder to spot than a vague
 *    original.
 *  - **Lost intent.** The one unrecoverable failure. The user will not re-read
 *    closely enough to catch it, will send it, and will blame the model for
 *    answering the wrong question.
 *  - **Wrong length.** A four-times-longer "rewrite" is usually the model
 *    answering the prompt instead of rewriting it.
 *
 * The gate is deliberately loose. Every check here can be wrong, and a false
 * refusal costs the user a feature while a false accept costs them a prompt
 * they did not write — but only if the check misses something *large*. So the
 * thresholds catch gross failures and let debatable ones through to the diff,
 * where the user decides.
 */

export type QualityProblem =
  /** A wrapper the instruction forbids survived into the suggestion. */
  | 'preamble'
  /** Specifics appear that the original never mentioned. */
  | 'fabricated-specifics'
  /** Too little of what the user was asking about survived. */
  | 'intent-lost'
  /** Every constraint the request carried was dropped. */
  | 'constraints-dropped'
  /** Long enough to suggest the model answered rather than rewrote. */
  | 'too-long'
  /** Too short to be carrying a request at all. */
  | 'too-short';

export interface QualityReport {
  ok: boolean;
  problems: QualityProblem[];
  /** Fraction of the original's content words still present. */
  intentRetention: number;
  /** Suggestion length over original length, in words. */
  lengthRatio: number;
  /** Specifics found in the suggestion but not the original. */
  invented: readonly string[];
}

/**
 * Words carrying no intent.
 *
 * Kept short on purpose. A long list would start removing words that do carry
 * meaning ("not", "before", "without"), and losing those is precisely the kind
 * of intent change this is meant to catch.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'that', 'this', 'these',
  'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in',
  'on', 'at', 'by', 'for', 'with', 'as', 'from', 'it', 'its', 'my', 'me', 'i',
  'you', 'your', 'we', 'our', 'they', 'them', 'he', 'she', 'his', 'her', 'do',
  'does', 'did', 'can', 'could', 'will', 'would', 'should', 'have', 'has',
  'had', 'please', 'just', 'some', 'any', 'so', 'up', 'out', 'about', 'into',

  /*
   * Politeness and hedging.
   *
   * Removing these is the whole point of the "shorter" style, so counting them
   * as intent would refuse the rewrites that did their job best. They are
   * listed separately from the grammatical words above because they are a
   * judgement — someone could reasonably disagree that "help" carries nothing.
   */
  'hi', 'hey', 'hello', 'thanks', 'thank', 'wondering', 'possibly', 'maybe',
  'really', 'sorry', 'trouble', 'appreciate', 'kindly', 'anyway', 'something',
  'anything', 'stuff', 'thing', 'things', 'there', 'much', 'too', 'like',
  'want', 'need', 'help', 'know', 'sure', 'makes', 'sense', 'good', 'nice',
]);

/**
 * Words that make a request narrower.
 *
 * Not intent words: constraints. "Write a function that does not use recursion"
 * and "write a function" are different requests, and the difference is one of
 * these. A rewrite that drops every one of them has changed what was asked,
 * however much of the wording it kept.
 *
 * Bare "not" is deliberately absent. "If it is not too much trouble" is
 * politeness, and treating its removal as a lost constraint would refuse every
 * good rewrite of a polite draft.
 */
const LIMIT_MARKERS = [
  'no', 'never', 'none', 'nor', 'neither', 'without', 'cannot', 'must', 'only',
  'under', 'least', 'exactly', 'avoid', 'except', 'exclude', 'omit', 'limit',
  'maximum', 'minimum',
];

const CONTRACTED_NEGATION = /\w+n't\b/i;

/** Placeholders are checked separately, by the guard. Never treated as content. */
const PLACEHOLDER = /\[[A-Z][A-Z0-9_]*\]/g;

/**
 * Patterns that look like a specific the user must have supplied.
 *
 * Each is something a model reaches for when it is filling in a blank:
 * a filename, a path, a URL, a version, a large number, or a code identifier.
 * Single digits are excluded — "3 examples" and numbered steps are ordinary
 * rewriting, not fabrication.
 */
const SPECIFIC_PATTERNS: readonly RegExp[] = [
  /\bhttps?:\/\/\S+/gi,
  /\b[\w-]+\.(?:ts|tsx|js|jsx|py|java|go|rb|rs|php|cs|cpp|json|ya?ml|sql|sh|md|txt|csv|html?|css|env)\b/gi,
  // Paths and pairs: src/auth.ts, try/catch, and/or.
  /\b[\w.-]+\/[\w.-]+\b/g,
  /\bv\d+(?:\.\d+)*\b/gi,
  /\b\d+\.\d+(?:\.\d+)*\b/g,
  // Two digits or more. Single digits are ordinary rewriting — "3 examples",
  // numbered steps — not a specific someone must have supplied.
  /\b\d{2,}\b/g,
  /\b[a-z0-9]+(?:_[a-z0-9]+)+\b/gi,
  /\b[a-z]+[A-Z][A-Za-z]*\b/g,
  // Anything call-shaped: getUserById(), O(n), setTimeout(0).
  /\b[A-Za-z_][\w.]*\([^)]*\)/g,
  /\b[A-Z]\+\+/g,
  // Region and instance names: us-east-1, gpt-4.
  /\b[a-z]+(?:-[a-z0-9]+)*-\d+\b/gi,
  /\b[A-Z]{2,}\b/g,
  /\b[A-Z]{1,4}\d{1,3}\b/g,
];

/**
 * A capitalised word, for proper-noun detection.
 *
 * The hardest fabrication to catch mechanically is a plain English word — a
 * model turning "why is it slow" into "why is my database query slow" invents
 * the entire subject using words that look like ordinary rewriting. Product
 * names are the detectable half of that: Postgres, Redis, React, Django.
 *
 * Only counted away from the start of a sentence, since every sentence starts
 * with a capital and reading those as names would refuse everything.
 */
const CAPITALISED = /\b[A-Z][a-z]{2,}(?:[A-Z][A-Za-z]*)*\b/g;
const SENTENCE_END = /[.!?:;\n>*-]$/;

function properNouns(text: string): string[] {
  const found: string[] = [];

  for (const match of text.matchAll(CAPITALISED)) {
    const before = text.slice(0, match.index).replace(/\s+$/, '');
    const sentenceStart = before === '' || SENTENCE_END.test(before) || /["'(]$/.test(before);
    if (!sentenceStart) found.push(match[0].toLowerCase());
  }

  return found;
}

/**
 * Openings the instruction forbids and `cleanResponse` strips.
 *
 * Checked again here because stripping is best-effort: it handles the shapes
 * seen so far, and this catches the ones it did not.
 */
const PREAMBLE_PATTERNS: readonly RegExp[] = [
  /^(?:sure|certainly|of course|absolutely|got it|okay|ok)\b[,!.: ]/i,
  /^here(?:'s| is| are)\b/i,
  /^(?:i(?:'ve| have)|i'll|i will)\s+(?:rewritten|improved|revised|updated|made)/i,
  /^(?:improved|rewritten|revised|refined|updated)\s+(?:prompt|version)\b/i,
  /^```/,
  /^(?:this|the following)\s+(?:is|version)\b/i,
];

/**
 * Length ceilings, in words of suggestion per word of original.
 *
 * There is no floor, and the absence is the interesting part. The first
 * version had one, and measuring against the real on-device model showed it
 * refusing four good rewrites out of twenty-one — every one of them a rambling
 * draft compressed to the request it actually contained, which is the feature
 * working, not failing. Forty words of politeness becoming "Explain caching at
 * a high level" is a ratio of 0.16 and exactly right.
 *
 * A rewrite that dropped requirements is caught by intent retention and the
 * constraint check, which look at what was lost rather than at how much.
 */
const CEILINGS: Record<RefinementStyle, number> = {
  // Similar length is stated in the instruction itself.
  clear: 2.5,
  // "Noticeably fewer words" — a longer result has ignored the instruction.
  concise: 1.2,
  // Expanding is the point, so this is high; it still has to stop somewhere
  // short of an essay.
  detailed: 4,
  technical: 3,
  beginner: 3,
};

/**
 * Below this many words, nothing can be carrying a request.
 *
 * Absolute rather than proportional, so it cannot punish a good compression.
 */
const MIN_USABLE_WORDS = 3;

/**
 * Absolute floor for the ceiling on very short drafts.
 *
 * "fix the bug" is three words, so a perfectly reasonable rewrite is already
 * 300% longer. Ratios are meaningless at this size, and enforcing one would
 * reject exactly the drafts refinement helps most.
 */
const SHORT_DRAFT_WORDS = 8;
const SHORT_DRAFT_CEILING = 40;

/**
 * Below this, too much of what the user was asking about has gone.
 *
 * Low on purpose. A good rewrite is allowed to replace most of the wording —
 * that is what "rewrite" means, and "shorter" exists precisely to throw words
 * away. What this catches is the rewrite that kept almost nothing, which is
 * always a different question rather than a better-phrased one. Anything
 * arguable goes to the diff, where the user decides.
 */
const MIN_INTENT_RETENTION = 0.25;

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Content words: lowercased, deduplicated, stopwords and placeholders removed. */
function contentWords(text: string): string[] {
  const stripped = text.replace(PLACEHOLDER, ' ');
  const tokens = stripped.toLowerCase().match(/[a-z][a-z0-9'-]*/g) ?? [];

  return [
    ...new Set(
      tokens.filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
    ),
  ];
}

/**
 * Whether a term from the original survived.
 *
 * Substring rather than exact match, so ordinary re-inflection — "bug" into
 * "bugs", "log" into "logging" — is not read as the user's subject being
 * dropped. A rewrite is allowed to change wording; it is not allowed to change
 * what the prompt is about.
 */
function survives(term: string, refinedLower: string): boolean {
  if (refinedLower.includes(term)) return true;
  // Common English endings, so "queries" matches "query" and "running" "run".
  const stem = term.replace(/(?:ies|es|s|ing|ed)$/, '');
  return stem.length >= 4 && refinedLower.includes(stem);
}

function specificsIn(text: string): string[] {
  // Placeholders are the guard's business, and they are full of the shapes
  // these patterns look for. Counting them here would flag every redacted
  // prompt as fabricated.
  const stripped = text.replace(PLACEHOLDER, ' ');
  const found = new Set<string>();

  for (const pattern of SPECIFIC_PATTERNS) {
    for (const match of stripped.matchAll(pattern)) {
      const value = match[0].trim();
      if (value !== '') found.add(value.toLowerCase());
    }
  }

  for (const name of properNouns(stripped)) found.add(name);

  return [...found];
}

/** Limit words present in a text. */
function limitMarkers(text: string): string[] {
  const lower = text.toLowerCase();
  const found = LIMIT_MARKERS.filter((marker) =>
    new RegExp(`\\b${marker}\\b`).test(lower),
  );

  if (CONTRACTED_NEGATION.test(lower)) found.push("n't");
  return found;
}

/** Whether a suggestion still carries a wrapper the instruction forbids. */
export function hasPreamble(text: string): boolean {
  const trimmed = text.trim();
  return PREAMBLE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Specifics in the suggestion that the original never mentioned.
 *
 * Compared against the whole original text rather than against its own
 * extracted specifics, so a value that appears in a different shape — a path
 * mentioned inside a sentence, say — is not counted as invented.
 */
export function inventedSpecifics(original: string, refined: string): string[] {
  const haystack = original.toLowerCase();
  return specificsIn(refined).filter((value) => !haystack.includes(value));
}

/**
 * Fraction of the original's content words still present.
 *
 * 1 when the original had no content words at all — there was nothing to lose,
 * and reporting 0 would refuse every rewrite of a very short draft.
 */
export function intentRetention(original: string, refined: string): number {
  const terms = contentWords(original);
  if (terms.length === 0) return 1;

  const refinedLower = refined.toLowerCase();
  const kept = terms.filter((term) => survives(term, refinedLower)).length;

  return kept / terms.length;
}

/**
 * Runs every check.
 *
 * Reports the measurements as well as the verdict, so a refusal can be
 * explained and so the numbers can be aggregated over a fixture set rather than
 * only asserted one at a time.
 */
export function evaluateRefinement(
  original: string,
  refined: string,
  style: RefinementStyle,
): QualityReport {
  const problems: QualityProblem[] = [];

  const originalWords = words(original).length;
  const refinedWords = words(refined).length;
  const lengthRatio = originalWords === 0 ? 0 : refinedWords / originalWords;

  const retention = intentRetention(original, refined);
  const invented = inventedSpecifics(original, refined);

  if (hasPreamble(refined)) problems.push('preamble');
  if (invented.length > 0) problems.push('fabricated-specifics');
  if (retention < MIN_INTENT_RETENTION) problems.push('intent-lost');

  // Which markers survived does not matter — "does not use recursion" becoming
  // "no recursion" is a good rewrite. Losing all of them is the failure.
  if (limitMarkers(original).length > 0 && limitMarkers(refined).length === 0) {
    problems.push('constraints-dropped');
  }

  const perWord = CEILINGS[style];
  const ceiling =
    originalWords <= SHORT_DRAFT_WORDS
      ? Math.max(perWord * originalWords, SHORT_DRAFT_CEILING)
      : perWord * originalWords;

  if (refinedWords > ceiling) problems.push('too-long');
  if (originalWords > SHORT_DRAFT_WORDS && refinedWords < MIN_USABLE_WORDS) {
    problems.push('too-short');
  }

  return {
    ok: problems.length === 0,
    problems,
    intentRetention: retention,
    lengthRatio,
    invented,
  };
}
