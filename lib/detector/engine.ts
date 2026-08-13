import { ALL_RULES } from './rules';
import type {
  DetectOptions,
  Finding,
  MatchContext,
  PlaceholderStyle,
  RedactionResult,
  Rule,
  Tier,
} from './types';

/**
 * Builds a placeholder token.
 *
 * Single source of truth for placeholder shape. `isLikelyPlaceholder` must
 * recognise everything produced here, or a second pass over redacted text
 * would re-detect our own tokens and redaction would stop being idempotent.
 */
export function formatPlaceholder(
  token: string,
  index: number,
  style: PlaceholderStyle = 'bracketed',
): string {
  return style === 'dummy'
    ? `dummy_${token.toLowerCase()}_${index}`
    : `[REDACTED_${token}_${index}]`;
}

/**
 * Matches any placeholder this engine emits, in either style.
 *
 * Lives beside `formatPlaceholder` on purpose: re-hydration has to recognise
 * exactly what redaction produced, and a pattern maintained separately from
 * the formatter would drift the moment either changed — leaving real values
 * stranded behind placeholders nobody could match.
 *
 * A fresh RegExp per call, since callers use it with `matchAll` and shared
 * global regexes carry `lastIndex` between uses.
 */
export function placeholderPattern(): RegExp {
  return /\[REDACTED_[A-Z0-9_]+_\d+\]|\bdummy_[a-z0-9_]+_\d+\b/g;
}

/**
 * Detection engine.
 *
 * ADR-004: pure. Takes a string, returns findings. No DOM, no extension APIs,
 * no I/O. Enforced by the ESLint override on this directory and by the Vitest
 * `lib` project running with no browser globals.
 *
 * Offsets are UTF-16 code unit indices — the same units JS string indexing
 * uses — so `text.slice(finding.start, finding.end)` always returns exactly
 * the matched value, including across emoji and other astral-plane characters.
 */

/** An accepted regex match, before overlap resolution and placeholder assignment. */
interface Candidate {
  rule: Rule;
  value: string;
  start: number;
  end: number;
}

/**
 * Clones a rule's pattern with the global flag guaranteed.
 *
 * Rules are module-level singletons, so using their RegExp objects directly
 * would share `lastIndex` across calls — a classic source of matches silently
 * going missing on every other scan. Cloning per scan makes `detect` safe to
 * call concurrently and repeatedly.
 */
function globalClone(pattern: RegExp, needIndices: boolean): RegExp {
  let flags = pattern.flags;
  if (!flags.includes('g')) flags += 'g';
  // The `d` flag exposes per-group offsets, which is the only way to know
  // where a capture group sits in the source text.
  if (needIndices && !flags.includes('d')) flags += 'd';
  return new RegExp(pattern.source, flags);
}

function collectCandidates(
  text: string,
  rules: readonly Rule[],
  disabled: ReadonlySet<string>,
): Candidate[] {
  const out: Candidate[] = [];

  for (const rule of rules) {
    if (disabled.has(rule.id)) continue;

    const group = rule.captureGroup;

    for (const match of text.matchAll(globalClone(rule.pattern, group !== undefined))) {
      // With a capture group, the surrounding match is only context used to
      // make the rule precise — the group alone is the secret to redact.
      const value = group === undefined ? match[0] : match[group];
      // A zero-length match cannot be redacted and would produce a degenerate
      // span, so skip it rather than emitting an empty finding.
      if (value === undefined || value.length === 0) continue;

      const start =
        group === undefined ? match.index : (match.indices?.[group]?.[0] ?? undefined);
      if (start === undefined) continue;

      out.push({ rule, value, start, end: start + value.length });
    }
  }

  return out;
}

function passesValidation(candidate: Candidate, text: string): boolean {
  const { rule, value, start, end } = candidate;
  if (!rule.validate) return true;

  const ctx: MatchContext = { text, start, end };
  try {
    return rule.validate(value, ctx);
  } catch {
    // A throwing validator is a bug, and we cannot know what it would have
    // decided. Keep the match: this is a tool whose purpose is preventing
    // leaks, so an unexpected failure should surface a possible secret to the
    // user rather than silently swallow it. The corpus suite (Task 5) is what
    // catches a validator that throws routinely.
    return true;
  }
}

function tierRank(tier: Tier): number {
  return tier === 'high' ? 0 : 1;
}

/**
 * Total ordering over candidates, used to decide which of two overlapping
 * matches survives. Every comparison is a value comparison — no reliance on
 * input order, rule registration order, or sort stability — so the result is
 * identical no matter how the candidates were gathered.
 *
 * Precedence: high tier, then higher specificity, then longer span, then
 * lexicographically earlier rule id, then earlier start offset.
 *
 * Specificity sits above span length so that a vendor-prefixed rule wins
 * against a generic keyword fallback even when the generic rule happens to
 * match more characters — naming the exact credential that leaked is more
 * useful to the user than redacting one character further.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  const byTier = tierRank(a.rule.tier) - tierRank(b.rule.tier);
  if (byTier !== 0) return byTier;

  const bySpecificity = (b.rule.specificity ?? 0) - (a.rule.specificity ?? 0);
  if (bySpecificity !== 0) return bySpecificity;

  const byLength = b.end - b.start - (a.end - a.start);
  if (byLength !== 0) return byLength;

  if (a.rule.id !== b.rule.id) return a.rule.id < b.rule.id ? -1 : 1;

  return a.start - b.start;
}

function overlaps(a: Candidate, b: Candidate): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Greedily accepts candidates in precedence order, dropping any that collide
 * with something already accepted.
 *
 * O(n·k) against accepted matches. Realistic prompts yield a handful of
 * findings, so this stays trivial; the performance budget in milestone
 * 0.2.0.4 revisits it if a pathological input proves otherwise.
 */
function resolveOverlaps(candidates: readonly Candidate[]): Candidate[] {
  const byPrecedence = [...candidates].sort(compareCandidates);
  const accepted: Candidate[] = [];

  for (const candidate of byPrecedence) {
    if (accepted.some((a) => overlaps(a, candidate))) continue;
    accepted.push(candidate);
  }

  // Emit in reading order — the approval UI walks findings top to bottom, and
  // redaction applies them right to left by offset.
  return accepted.sort((a, b) => a.start - b.start);
}

/**
 * Assigns placeholder tokens, numbering distinct values per rule.
 *
 * The same secret appearing three times in a prompt collapses to one
 * placeholder, so the model sees a consistent identifier and the user reviews
 * one item instead of three.
 */
function assignPlaceholders(
  candidates: readonly Candidate[],
  style: PlaceholderStyle,
): Finding[] {
  // Nested rather than a composite string key: no separator character has to
  // be assumed absent from secret values, so two rules cannot collide.
  const indexByRuleAndValue = new Map<string, Map<string, number>>();
  const countByRule = new Map<string, number>();

  return candidates.map((candidate) => {
    const { rule, value, start, end } = candidate;
    let seen = indexByRuleAndValue.get(rule.id);
    if (!seen) {
      seen = new Map<string, number>();
      indexByRuleAndValue.set(rule.id, seen);
    }

    let index = seen.get(value);
    if (index === undefined) {
      index = (countByRule.get(rule.id) ?? 0) + 1;
      countByRule.set(rule.id, index);
      seen.set(value, index);
    }

    return {
      ruleId: rule.id,
      label: rule.label,
      tier: rule.tier,
      start,
      end,
      placeholder: formatPlaceholder(rule.token, index, style),
    };
  });
}

/**
 * Scans text and returns everything detected, in reading order.
 *
 * @param text    the text to scan
 * @param options user settings — disabled rules, allowlist predicate
 * @param rules   injectable for testing; defaults to the full registry
 *
 * Note there is no input size cap here. Silently truncating would mean
 * silently failing to detect, which is the one failure mode this product
 * cannot have. Guarding against pathological input belongs at the
 * interception layer (milestone 0.0.3.4), where it can be handled without
 * pretending the tail of the text was clean.
 */
export function detect(
  text: string,
  options: DetectOptions = {},
  rules: readonly Rule[] = ALL_RULES,
): Finding[] {
  if (text.length === 0) return [];

  const disabled = new Set(options.disabledRuleIds ?? []);
  let candidates = collectCandidates(text, rules, disabled);

  candidates = candidates.filter((c) => passesValidation(c, text));

  const isAllowlisted = options.isAllowlisted;
  if (isAllowlisted) {
    candidates = candidates.filter((c) => {
      try {
        return !isAllowlisted(c.value);
      } catch {
        // Same reasoning as a throwing validator: keep the finding.
        return true;
      }
    });
  }

  return assignPlaceholders(
    resolveOverlaps(candidates),
    options.placeholderStyle ?? 'bracketed',
  );
}

/**
 * Applies findings to text, returning the redacted string and the
 * placeholder -> value map.
 *
 * Substitutions are applied right-to-left by offset so that the offsets of
 * findings not yet processed stay valid as the string is rewritten. Values are
 * always read from the ORIGINAL text, since offsets refer to it.
 *
 * The returned map is what feeds the session vault in milestone 0.0.5.0, which
 * is how a response containing `[REDACTED_AWS_KEY_1]` gets the real value
 * swapped back in locally. Per ADR-005 that map holds real secrets and must
 * never be written to `chrome.storage.local` or `.sync`.
 *
 * Findings must come from `detect()` over this same text. Overlapping findings
 * cannot be applied coherently, so any finding overlapping one already applied
 * is skipped rather than silently corrupting the output — `detect()` resolves
 * overlaps, so this only guards against hand-assembled input.
 */
export function redact(text: string, findings: readonly Finding[]): RedactionResult {
  const map: Record<string, string> = {};

  // Resolve overlaps by preferring the WIDER span. Redacting an inner span
  // would leave the surrounding characters of the outer value exposed, which
  // is a partial leak — the one outcome worth being deliberate about here.
  const accepted: Finding[] = [];
  const byWidth = [...findings].sort((a, b) => b.end - b.start - (a.end - a.start));

  for (const finding of byWidth) {
    if (finding.start < 0 || finding.end > text.length) continue;
    if (finding.end <= finding.start) continue;
    if (accepted.some((a) => finding.start < a.end && a.start < finding.end)) continue;
    accepted.push(finding);
  }

  let out = text;
  for (const finding of accepted.sort((a, b) => b.start - a.start)) {
    map[finding.placeholder] = text.slice(finding.start, finding.end);
    out = out.slice(0, finding.start) + finding.placeholder + out.slice(finding.end);
  }

  return { text: out, map };
}

/**
 * Convenience wrapper: scan and redact in one call.
 *
 * Returns the findings alongside the result so the approval UI can show what
 * changed without scanning twice.
 */
export function detectAndRedact(
  text: string,
  options: DetectOptions = {},
  rules: readonly Rule[] = ALL_RULES,
): RedactionResult & { findings: Finding[] } {
  const findings = detect(text, options, rules);
  return { ...redact(text, findings), findings };
}
