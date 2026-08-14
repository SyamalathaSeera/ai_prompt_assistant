/**
 * Vague-reference scanning.
 *
 * Pure, like the detector: a function of its input string. No DOM, no model,
 * no storage. This is the cheap gate that decides whether the expensive part
 * of clarification — reading the conversation and asking a model — is worth
 * starting at all. Most prompts must never get past this file.
 *
 * **The bias here is silence.** Every heuristic below resolves ambiguity in
 * favour of "the user is fine, say nothing". A missed clarification costs the
 * user nothing they were not already going to pay; an offered one costs them
 * attention they did not ask to spend. Milestone 0.4.0.0 Task 4 tightens this
 * further, and nothing here should drift the other way without a reason
 * written down next to it.
 */

/**
 * What kind of thing the reference points at.
 *
 * The distinction matters because they fail differently. A demonstrative may
 * well have its antecedent in the same sentence, so it has to be checked
 * against the prompt before assuming it points outward. A `prior-work` phrase
 * — "like before", "the above" — points outward by construction; there is
 * nothing in the draft that could resolve it.
 */
export type ReferenceKind = 'demonstrative' | 'locative' | 'prior-work';

export interface VagueReference {
  /** The phrase exactly as it appeared, for showing the user what we matched. */
  text: string;
  /** Character offset in the original draft. */
  start: number;
  /** Character offset of the end (exclusive). */
  end: number;
  kind: ReferenceKind;
}

/**
 * Replaces fenced and inline code with spaces, preserving every offset.
 *
 * A `this` inside a code block is the language's keyword, or a variable, or
 * someone else's prose being quoted — never the user pointing at an earlier
 * turn. Scanning it would fire the feature on any draft containing a
 * JavaScript snippet, which is most of them in this product's audience.
 *
 * Spaces rather than removal so that offsets still index into the original
 * draft and can be shown back to the user.
 */
export function maskCode(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return text
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/`[^`\n]*`/g, blank);
}

/**
 * Signals that a draft names something concrete.
 *
 * Used for two different jobs: deciding whether a demonstrative already has an
 * antecedent in the prompt itself, and deciding whether the whole prompt is
 * specific enough to need no help. Both reduce to "did the user actually name
 * a thing, or are they gesturing".
 */
const ANCHOR_PATTERNS: readonly RegExp[] = [
  /```[\s\S]*?```/g, // a code block
  /`[^`\n]*`/g, // an inline code span
  /\bhttps?:\/\/\S+/gi, // a URL
  /\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|cs|php|sql|sh|yml|yaml|json|toml|md|css|scss|html)\b/gi, // a filename
  /(?:^|\s)\.{0,2}\/[\w./-]+/g, // a path
  /"[^"\n]{2,}"|'[^'\n]{2,}'/g, // a quoted string
  /\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g, // camelCase
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi, // snake_case
  /\b\w+\(\)/g, // a function call
  /\b\d+(?:\.\d+)?\s*(?:ms|s|kb|mb|gb|px|%)\b/gi, // a measurement
];

/** Every position at which the draft names something concrete. */
function anchorOffsets(text: string): number[] {
  const offsets: number[] = [];
  for (const pattern of ANCHOR_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    for (const m of text.matchAll(re)) {
      if (m.index !== undefined) offsets.push(m.index);
    }
  }
  return offsets;
}

/** How many distinct kinds of concrete thing the draft names. */
export function anchorVariety(text: string): number {
  let kinds = 0;
  for (const pattern of ANCHOR_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    if (re.test(text)) kinds += 1;
  }
  return kinds;
}

/** Whether the draft names something concrete before the given offset. */
function hasAnchorBefore(text: string, index: number): boolean {
  return anchorOffsets(text.slice(0, index)).length > 0;
}

/**
 * Words which, following a demonstrative, mean it was used as a pronoun
 * rather than as a determiner.
 *
 * "Fix this file" names its own subject. "Fix this" does not. Without a POS
 * tagger the practical test is what comes next: a verb, preposition, or
 * conjunction after "this" means the demonstrative stood alone.
 *
 * Deliberately a small closed list rather than a clever suffix rule. A suffix
 * heuristic (`-er` implies a comparative) reads "update this server" as a bare
 * pronoun and fires on a prompt that named its own subject. Anything not
 * listed here is assumed to be a noun, which is the quiet answer.
 */
const PRONOUN_FOLLOWERS = new Set([
  // verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must',
  'do', 'does', 'did', 'has', 'have', 'had',
  'looks', 'look', 'seems', 'seem', 'works', 'work', 'breaks', 'break', 'fails', 'fail',
  // prepositions
  'to', 'into', 'onto', 'over', 'under', 'on', 'in', 'at', 'for', 'with',
  'from', 'by', 'about', 'after', 'before', 'instead', 'without', 'across',
  // conjunctions
  'and', 'or', 'but', 'so', 'then', 'because', 'if', 'when', 'while',
  // adverbs and particles
  'too', 'again', 'also', 'now', 'here', 'there', 'up', 'down', 'out', 'off',
  'away', 'back', 'please', 'first', 'next', 'last', 'more', 'less',
  // the handful of comparatives that actually show up in prompts
  'better', 'cleaner', 'shorter', 'longer', 'faster', 'clearer', 'simpler',
  'tighter', 'properly', 'correctly', 'concise', 'clear',
]);

/** Whether a demonstrative at `end` was used alone, with no noun after it. */
function isPronounUse(text: string, end: number): boolean {
  const next = /^\s*([A-Za-z']+)/.exec(text.slice(end))?.[1];
  // Punctuation or end of text: nothing followed it, so it stood alone.
  if (next === undefined) return true;
  return PRONOUN_FOLLOWERS.has(next.toLowerCase());
}

const DEMONSTRATIVES = /\b(?:this|that|these|those|it)\b/gi;

/**
 * Phrases that point outside the draft by construction.
 *
 * No antecedent check applies to these: "like before" cannot be resolved by
 * anything in the prompt, which is the whole reason it is worth asking about.
 * The list is curated rather than generated — each entry is a phrase people
 * actually type at a chat window that has history above it.
 */
const PRIOR_WORK: readonly RegExp[] = [
  /\bthe above\b/gi,
  /\bas above\b/gi,
  /\babove that\b/gi,
  /\b(?:like|as|same as) before\b/gi,
  /\blast time\b/gi,
  /\bas (?:we )?discussed\b/gi,
  /\bwe (?:discussed|talked about)\b/gi,
  /\byou (?:mentioned|suggested|said|wrote)\b/gi,
  /\bearlier\b/gi,
  /\bthe previous (?:one|version|answer|response|example|attempt)\b/gi,
  /\bthat one\b/gi,
  /\bthe one you\b/gi,
  /\bthe same (?:thing|way|approach|style|idea)\b/gi,
];

/** Prepositions that turn "there" or "here" into a place rather than a filler. */
const LOCATIVE_PREFIXES = new Set([
  'over', 'in', 'out', 'up', 'down', 'back', 'from', 'under', 'around', 'right',
]);

/** Verbs that make "there"/"here" existential — "there is a bug" names no place. */
const EXISTENTIAL_FOLLOWERS = new Set(['is', 'are', 'was', 'were', "'s", 'has', 'have']);

const LOCATIVES = /\b(?:there|here)\b/gi;

/**
 * Finds references in a draft that the draft itself does not resolve.
 *
 * Offsets index into `draft` as given, so a caller can slice the phrase back
 * out and show it. Code is masked before scanning but anchors are looked for
 * in the original, because a code block the user pasted is a perfectly good
 * antecedent for "refactor this" even though its contents are not prose.
 */
export function findVagueReferences(draft: string): VagueReference[] {
  const scannable = maskCode(draft);
  const found: VagueReference[] = [];

  for (const m of scannable.matchAll(DEMONSTRATIVES)) {
    const start = m.index;
    if (start === undefined) continue;
    const end = start + m[0].length;

    // "this file" names its own subject; only a bare demonstrative gestures.
    // "it" is always a pronoun, so the question never arises.
    const bare = m[0].toLowerCase() === 'it' || isPronounUse(scannable, end);
    if (!bare) continue;

    // Something concrete was already named, so the reference most likely
    // points at that rather than at an earlier turn.
    if (hasAnchorBefore(draft, start)) continue;

    found.push({ text: draft.slice(start, end), start, end, kind: 'demonstrative' });
  }

  for (const m of scannable.matchAll(LOCATIVES)) {
    const start = m.index;
    if (start === undefined) continue;
    const end = start + m[0].length;

    const before = /([A-Za-z']+)(\s*)$/.exec(scannable.slice(0, start));
    if (!before || !LOCATIVE_PREFIXES.has(before[1]!.toLowerCase())) continue;

    const after = /^\s*([A-Za-z']+)/.exec(scannable.slice(end))?.[1];
    if (after !== undefined && EXISTENTIAL_FOLLOWERS.has(after.toLowerCase())) continue;

    /*
     * The span starts at the preposition, not at "there".
     *
     * "over there" is the reference; "there" alone is half of it. This matters
     * twice over: it is what the user is shown, and it is what gets excluded
     * from the intent-retention baseline in `interpret.ts`. Leaving "over"
     * outside the span would count it as meaning the rewrite lost, when in
     * fact it is meaning the rewrite was asked to replace.
     */
    const phraseStart = start - (before[1]!.length + before[2]!.length);

    if (hasAnchorBefore(draft, phraseStart)) continue;

    found.push({
      text: draft.slice(phraseStart, end),
      start: phraseStart,
      end,
      kind: 'locative',
    });
  }

  for (const pattern of PRIOR_WORK) {
    const re = new RegExp(pattern.source, pattern.flags);
    for (const m of scannable.matchAll(re)) {
      const start = m.index;
      if (start === undefined) continue;
      const end = start + m[0].length;
      found.push({ text: draft.slice(start, end), start, end, kind: 'prior-work' });
    }
  }

  // Sorted and de-overlapped so the caller can show them in reading order and
  // never highlight the same span twice.
  found.sort((a, b) => a.start - b.start || b.end - a.end);

  const merged: VagueReference[] = [];
  for (const ref of found) {
    const last = merged[merged.length - 1];
    if (last && ref.start < last.end) continue;
    merged.push(ref);
  }
  return merged;
}
