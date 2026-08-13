/**
 * Masked previews for the approval modal.
 *
 * The user needs to recognise *which* secret each row refers to — "is that my
 * production key or the test one?" — without the value being legible on
 * screen. This panel appears over whatever the user is doing, which may be a
 * shared screen or a recorded call, so a modal that prints secrets back at
 * full length would be its own small leak.
 */

/** Maximum characters revealed at each end. */
const EDGE = 4;

/**
 * Below this length, nothing is revealed at all.
 *
 * Showing four characters from each end of a ten-character secret leaks eighty
 * percent of it. Short values are identified by their label and position
 * instead, which is enough — a prompt rarely contains two of the same kind.
 */
const MIN_LENGTH_TO_REVEAL = 16;

/**
 * Renders a value as a recognisable but unreadable preview.
 *
 * `AKIA3TZ2MRSYNTHETIC7` becomes `AKIA…TIC7`; anything short becomes dots.
 * Whitespace is collapsed so a pasted multi-line key block renders as one row
 * rather than reflowing the dialog.
 */
export function maskValue(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();

  if (collapsed.length === 0) return '';
  if (collapsed.length < MIN_LENGTH_TO_REVEAL) {
    return '•'.repeat(Math.min(collapsed.length, 12));
  }

  return `${collapsed.slice(0, EDGE)}…${collapsed.slice(-EDGE)}`;
}

/** Human-readable size, so a redacted key block is not just a bare ellipsis. */
export function describeLength(value: string): string {
  const n = value.length;
  return n === 1 ? '1 character' : `${n} characters`;
}
