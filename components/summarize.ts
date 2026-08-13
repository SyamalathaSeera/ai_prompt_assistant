import type { Finding } from '@/lib/detector/types';

/**
 * Turns findings into something a person can read at a glance.
 *
 * The modal appears while someone is trying to do something else, so the first
 * line has to answer "what did you find?" in under a second. A list of raw
 * values would be slower to read AND would put the secrets back on screen —
 * which is the opposite of the point.
 */

export interface FindingGroup {
  label: string;
  /** Distinct values, not occurrences: one key pasted twice is one problem. */
  count: number;
  tier: 'high' | 'low';
}

/** Groups findings by label, counting distinct placeholders. */
export function groupFindings(findings: readonly Finding[]): FindingGroup[] {
  const byLabel = new Map<string, { tier: 'high' | 'low'; placeholders: Set<string> }>();

  for (const finding of findings) {
    let group = byLabel.get(finding.label);
    if (!group) {
      group = { tier: finding.tier, placeholders: new Set() };
      byLabel.set(finding.label, group);
    }
    group.placeholders.add(finding.placeholder);
  }

  return [...byLabel.entries()]
    .map(([label, group]) => ({
      label,
      count: group.placeholders.size,
      tier: group.tier,
    }))
    .sort((a, b) => {
      // Blocking items first, then the most numerous, then alphabetical.
      if (a.tier !== b.tier) return a.tier === 'high' ? -1 : 1;
      if (a.count !== b.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });
}

/** Naive pluralisation, adequate for the fixed set of rule labels we ship. */
function pluralize(label: string, count: number): string {
  if (count === 1) return label;
  if (/(s|x|z|ch|sh)$/i.test(label)) return `${label}es`;
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}

/**
 * A one-line summary, e.g. "2 AWS Access Key IDs and 1 Stripe Live Key".
 *
 * Lists at most three kinds before collapsing the rest, because a sentence
 * with six clauses stops being scannable and the user is mid-task.
 */
export function summarize(findings: readonly Finding[]): string {
  const groups = groupFindings(findings);
  if (groups.length === 0) return 'No sensitive data found';

  const parts = groups
    .slice(0, 3)
    .map((group) => `${group.count} ${pluralize(group.label, group.count)}`);

  const remaining = groups.length - 3;
  if (remaining > 0) {
    parts.push(`${remaining} other ${pluralize('kind', remaining)}`);
  }

  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
