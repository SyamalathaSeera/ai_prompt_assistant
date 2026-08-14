/**
 * Word-level diff for the refinement review.
 *
 * The user has to answer "what did it change?" in a couple of seconds. A
 * character diff produces noise on every reflowed word; showing the two texts
 * side by side makes them do the comparison themselves. Word granularity is
 * what matches how someone actually reads a rewritten sentence.
 *
 * Deliberately small and dependency-free. This runs in a content script on
 * every refinement, and a diff library would be more bytes than the entire
 * detector.
 */

export type DiffOp = 'same' | 'added' | 'removed';

export interface DiffSegment {
  op: DiffOp;
  text: string;
}

/** Splits into words while keeping the whitespace, so output can be rebuilt exactly. */
function tokenise(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/**
 * Longest common subsequence over tokens.
 *
 * O(n·m). Prompts are short — a few hundred tokens at most — and the
 * alternative is an approximate diff that occasionally marks an unchanged
 * sentence as rewritten, which would undermine the one thing this view is for.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  return table;
}

/** Merges adjacent segments of the same kind, so rendering is not fragmented. */
function coalesce(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];

  for (const segment of segments) {
    const last = out[out.length - 1];
    if (last && last.op === segment.op) {
      last.text += segment.text;
    } else {
      out.push({ ...segment });
    }
  }

  return out;
}

/**
 * Diffs two prompts at word granularity.
 *
 * Guards against pathological input: above this size the quadratic table costs
 * more than the view is worth, and the whole-text fallback still tells the
 * truth — everything changed.
 */
const MAX_TOKENS = 2000;

export function diffWords(before: string, after: string): DiffSegment[] {
  if (before === after) return before === '' ? [] : [{ op: 'same', text: before }];

  const a = tokenise(before);
  const b = tokenise(after);

  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return coalesce([
      { op: 'removed', text: before },
      { op: 'added', text: after },
    ]);
  }

  const table = lcsTable(a, b);
  const segments: DiffSegment[] = [];

  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      segments.push({ op: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      segments.push({ op: 'removed', text: a[i]! });
      i += 1;
    } else {
      segments.push({ op: 'added', text: b[j]! });
      j += 1;
    }
  }

  while (i < a.length) {
    segments.push({ op: 'removed', text: a[i]! });
    i += 1;
  }
  while (j < b.length) {
    segments.push({ op: 'added', text: b[j]! });
    j += 1;
  }

  return coalesce(segments);
}

/** How much of the text actually changed, 0 to 1. Used to describe the edit. */
export function changeRatio(segments: readonly DiffSegment[]): number {
  const total = segments.reduce((sum, s) => sum + s.text.length, 0);
  if (total === 0) return 0;

  const changed = segments
    .filter((s) => s.op !== 'same')
    .reduce((sum, s) => sum + s.text.length, 0);

  return changed / total;
}
