import { inventedSpecifics } from '../refine/evaluate';
import type { ContextTurn, IncludedTurn } from './context';

/**
 * Grounding: proving every word the rewrite added came from the conversation.
 *
 * This is the executable bar for clarification, and it is stricter than the
 * one refinement uses. Refinement may add nothing; clarification must add
 * something — that is what resolving a reference means — so "did it invent
 * anything" is not a question about *whether* words appeared, but about
 * *where they came from*.
 *
 * The rule: every phrase the rewrite introduced must be findable in a turn
 * that was actually shown to the model. Not merely in the conversation — in
 * the turns that made it past the budget in `context.ts`. A phrase that only
 * appears in a turn the model never saw is not a resolution, it is a
 * coincidence, and treating it as grounded would launder a fabrication.
 *
 * The payoff is the guarantee Task 3 requires: every resolution shown to the
 * user carries the turn it came from, because a resolution that cannot name
 * its turn is refused rather than displayed.
 */

/**
 * Grammatical words only.
 *
 * Deliberately NOT the stopword list in `refine/evaluate.ts`. That one also
 * strips politeness and hedging ("wondering", "help", "thing") because its job
 * is measuring whether intent survived. Here the job is finding which words are
 * new, and dropping "thing" would silently hide a rewrite that turned "the
 * thing" into "the thing you mentioned" — the exact substitution this feature
 * makes. Two lists, two purposes; merging them would break one of them.
 */
const GRAMMATICAL = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'so', 'as', 'than',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'have', 'has', 'had',
  'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto',
  'over', 'under', 'about', 'out', 'up', 'down', 'off', 'again',
  'i', 'me', 'my', 'you', 'your', 'we', 'our', 'us', 'they', 'them', 'their',
  'it', 'its', 'he', 'she', 'his', 'her',
  'this', 'that', 'these', 'those', 'there', 'here',
  'not', 'no', 'please', 'just', 'also', 'too', 'very',
]);

/** Placeholders are the guard's business and never count as content. */
const PLACEHOLDER = /\[[A-Z][A-Z0-9_]*\]/g;

/**
 * Reduces a word to something that survives ordinary re-inflection.
 *
 * "queries" and "query", "logging" and "log". Without this, a rewrite that
 * pluralised a word the user already wrote would be reported as new content —
 * and, worse, refused as ungrounded.
 */
export function stem(word: string): string {
  const lower = word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (lower.length < 4) return lower;

  let s = lower;
  if (/ies$/.test(s)) s = `${s.slice(0, -3)}y`;
  else if (/(?:sses|shes|ches|xes|zes)$/.test(s)) s = s.slice(0, -2);
  else if (/ing$/.test(s)) s = s.slice(0, -3);
  else if (/ed$/.test(s)) s = s.slice(0, -2);
  else if (/es$/.test(s)) s = s.slice(0, -1);
  else if (/[^s]s$/.test(s)) s = s.slice(0, -1);

  // Collapses the doubled consonant that -ing and -ed removal leaves behind,
  // so "running" and "run" agree.
  if (/([bdfglmnprt])\1$/.test(s)) s = s.slice(0, -1);

  return s.length >= 3 ? s : lower;
}

/** Content words of a text, stemmed, as a set. */
function contentStems(text: string): Set<string> {
  const tokens = text.replace(PLACEHOLDER, ' ').toLowerCase().match(/[a-z0-9][\w'-]*/g) ?? [];
  return new Set(
    tokens.filter((token) => !GRAMMATICAL.has(token)).map((token) => stem(token)),
  );
}

/**
 * Phrases the rewrite introduced that the draft did not have.
 *
 * Runs of new content words, allowed to bridge a single grammatical word so
 * that "the login form on the settings page" comes back as one phrase rather
 * than three fragments. Fragments would be unreadable in the UI and would each
 * have to be attributed separately, multiplying the chance of a wrong turn.
 */
export function addedPhrases(draft: string, rewrite: string): string[] {
  const known = contentStems(draft);
  const tokens = rewrite.replace(PLACEHOLDER, ' ').match(/[A-Za-z0-9][\w'-]*/g) ?? [];

  const phrases: string[] = [];
  let current: string[] = [];
  let pendingBridge: string | null = null;

  const flush = () => {
    if (current.some((word) => !GRAMMATICAL.has(word.toLowerCase()))) {
      phrases.push(current.join(' '));
    }
    current = [];
    pendingBridge = null;
  };

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (GRAMMATICAL.has(lower)) {
      // A grammatical word only joins a phrase already in progress, and only
      // if more new content follows it.
      if (current.length > 0 && pendingBridge === null) pendingBridge = token;
      else if (current.length > 0) flush();
      continue;
    }

    if (known.has(stem(token))) {
      flush();
      continue;
    }

    if (pendingBridge !== null) {
      current.push(pendingBridge);
      pendingBridge = null;
    }
    current.push(token);
  }
  flush();

  return phrases;
}

/** One thing the rewrite resolved, and the turn it came from. */
export interface Resolution {
  /** The phrase the rewrite introduced. */
  text: string;
  /** Index into the full turn array — the handle for pointing at the page. */
  turnIndex: number;
  /** The host page's message id for that turn, when it exposes one. */
  turnId: string | null;
  role: 'user' | 'assistant';
}

export type GroundingResult =
  | { ok: true; resolutions: readonly Resolution[] }
  | { ok: false; ungrounded: readonly string[] };

/** Whether every content word of a phrase appears in a turn. */
function turnContains(turnText: string, phrase: string): boolean {
  const available = contentStems(turnText);
  const needed = [...contentStems(phrase)];
  if (needed.length === 0) return false;
  return needed.every((word) => available.has(word));
}

/**
 * Checks a rewrite against the turns the model was actually shown.
 *
 * Returns the resolutions when everything the rewrite added can be traced, and
 * the offending phrases when it cannot. There is no partial success: an
 * interpretation containing one invented detail is not worth showing with a
 * warning next to it, because the user is being asked a yes/no question about
 * whether it matches what they meant, and a question containing a fabrication
 * is a trap.
 */
export function groundResolutions(
  draft: string,
  rewrite: string,
  turns: readonly ContextTurn[],
  included: readonly IncludedTurn[],
): GroundingResult {
  const searchable = included
    .map((entry) => ({ entry, text: turns[entry.index]?.text ?? '' }))
    .filter(({ text }) => text.trim() !== '');

  const resolutions: Resolution[] = [];
  const ungrounded: string[] = [];

  const attribute = (phrase: string) => {
    const hit = searchable.find(({ text }) => turnContains(text, phrase));
    if (!hit) {
      ungrounded.push(phrase);
      return;
    }
    resolutions.push({
      text: phrase,
      turnIndex: hit.entry.index,
      turnId: hit.entry.id,
      role: hit.entry.role,
    });
  };

  for (const phrase of addedPhrases(draft, rewrite)) attribute(phrase);

  /*
   * Specifics are checked separately as well as through the phrase pass.
   *
   * A path, a version number, or a call like `getUser()` can survive the word
   * tokenizer in a shape the phrase walk does not reassemble — and those are
   * precisely the details a model reaches for when it is filling in a blank.
   * Checking both means a fabricated file path cannot slip through on a
   * technicality of tokenisation.
   */
  const seen = new Set(resolutions.map((r) => r.text.toLowerCase()));
  for (const specific of inventedSpecifics(draft, rewrite)) {
    if (seen.has(specific)) continue;
    if (resolutions.some((r) => r.text.toLowerCase().includes(specific))) continue;
    if (ungrounded.some((phrase) => phrase.toLowerCase().includes(specific))) continue;
    attribute(specific);
  }

  if (ungrounded.length > 0) return { ok: false, ungrounded };
  return { ok: true, resolutions };
}
