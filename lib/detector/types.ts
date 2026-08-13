/**
 * Detector types.
 *
 * ADR-004: everything under lib/detector/ is pure — a function of its input
 * string. No DOM, no extension APIs, no I/O. Enforced by the ESLint override
 * on this directory and by the Vitest `lib` project's node environment.
 */

/**
 * Detection confidence tier.
 *
 * `high` — structured secrets with a shape precise enough that a false
 * positive is close to impossible (AWS keys, `ghp_` tokens, PEM headers,
 * Luhn-valid cards). These block submission, so the bar is precision.
 *
 * `low` — soft PII (email, phone, address). Suggested, never blocking.
 *
 * A rule only belongs in `high` if firing it on innocent text would be a bug.
 * False-positive fatigue is the primary uninstall driver for this category of
 * tool, which is why the two tiers behave so differently.
 */
export type Tier = 'high' | 'low';

/**
 * A single detected item.
 *
 * Deliberately does NOT carry the matched value. Callers slice it out of the
 * source text when they need it. Keeping secrets off this object means a
 * Finding can be logged, counted, or passed around without becoming a leak.
 */
export interface Finding {
  /** Stable rule identifier, e.g. `aws.access_key_id`. */
  ruleId: string;
  /** Human-readable label shown in the approval UI, e.g. `AWS Access Key ID`. */
  label: string;
  tier: Tier;
  /** Character offset of the match start in the source text. */
  start: number;
  /** Character offset of the match end (exclusive). */
  end: number;
  /** Replacement token, e.g. `[REDACTED_AWS_KEY_1]`. */
  placeholder: string;
}

/** Context passed to a rule's validator so it can make a smarter decision. */
export interface MatchContext {
  /** The full source text the match came from. */
  text: string;
  start: number;
  end: number;
}

/**
 * One detection rule.
 *
 * Rules live one family per file under `rules/`. Adding a rule should mean
 * adding a file and registering it — nothing else.
 */
export interface Rule {
  id: string;
  label: string;
  tier: Tier;
  /** Global regex. The engine handles lastIndex management. */
  pattern: RegExp;
  /**
   * Optional suppression pass. Return false to reject a regex match.
   * This is where Luhn checks, entropy gates, and documentation-placeholder
   * detection live — the layer that removes most false-positive risk.
   */
  validate?: (match: string, ctx: MatchContext) => boolean;
  /** Builds the placeholder token. `index` is stable per distinct value. */
  placeholder: (index: number) => string;
}

/** Options controlling a single detection pass. */
export interface DetectOptions {
  /** Rule ids to skip entirely (from user settings). */
  disabledRuleIds?: readonly string[];
  /** Hashed allowlist entries; matching values are suppressed. */
  allowlistHashes?: readonly string[];
}

/** Result of applying redactions to a source text. */
export interface RedactionResult {
  /** The text with placeholders substituted in. */
  text: string;
  /**
   * placeholder -> real value. Feeds the session vault (milestone 0.0.5.0)
   * so responses can be re-hydrated locally. Never persisted to
   * `chrome.storage.local` or `.sync` — see ADR-005.
   */
  map: Readonly<Record<string, string>>;
}
