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
 * How placeholders are rendered.
 *
 * `bracketed` — `[REDACTED_AWS_ACCESS_KEY_ID_1]`. The default: unmistakably a
 * substitution, so the model does not mistake it for a real value.
 *
 * `dummy` — `dummy_aws_access_key_id_1`. For the occasional case where a
 * bracketed token confuses a model into commenting on the redaction instead of
 * doing the task.
 */
export type PlaceholderStyle = 'bracketed' | 'dummy';

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
  /**
   * One line of plain language for the options page, e.g.
   * "Keys beginning AKIA that identify an AWS account".
   *
   * Lives on the rule rather than in a lookup table in the UI: a description
   * maintained separately would drift from what the rule actually matches, and
   * a settings page that misdescribes what it controls is worse than one with
   * no descriptions at all.
   */
  description?: string;
  tier: Tier;
  /** Global regex. The engine handles lastIndex management. */
  pattern: RegExp;
  /**
   * When set, only this capture group is treated as the secret; the rest of
   * the match is context used to make the rule precise.
   *
   * This exists because the PRD requires redactions to preserve enough context
   * for the model to still understand the task. `DB_PASSWORD=[REDACTED_1]`
   * keeps the request intelligible; replacing the whole line with
   * `[REDACTED_1]` does not. It also lets a generic-looking value (a bare
   * 40-char base64 string) be matched precisely by anchoring on the keyword
   * that precedes it.
   */
  captureGroup?: number;
  /**
   * Tie-breaker when two rules claim the same span. Higher wins; default 0.
   *
   * A vendor key inside a config assignment — `STRIPE_SECRET_KEY=sk_live_…` —
   * is the common real-world case, and both the vendor rule and the generic
   * keyword rule match it identically. Without this the tie falls to rule id,
   * which is arbitrary, and the user gets told "Secret in Configuration" when
   * the extension could have told them precisely which vendor key leaked.
   *
   * Convention: generic keyword-anchored fallbacks sit below 0, prefix-anchored
   * vendor rules stay at the 0 default.
   */
  specificity?: number;
  /**
   * Optional suppression pass. Return false to reject a regex match.
   * This is where Luhn checks, entropy gates, and documentation-placeholder
   * detection live — the layer that removes most false-positive risk.
   */
  validate?: (match: string, ctx: MatchContext) => boolean;
  /**
   * Type name used to build the placeholder, e.g. `AWS_ACCESS_KEY_ID`.
   *
   * The engine formats the final token from this plus the occurrence index and
   * the configured style, rather than each rule building its own string. That
   * keeps placeholder shape in exactly one place — which matters because
   * `isLikelyPlaceholder` has to recognise every shape we emit, or redaction
   * stops being idempotent.
   */
  token: string;
}

/** Options controlling a single detection pass. */
export interface DetectOptions {
  /** Rule ids to skip entirely (from user settings). */
  disabledRuleIds?: readonly string[];
  /**
   * Suppresses values the user has permanently allowlisted.
   *
   * A predicate rather than a list of hashes, deliberately. Hashing is the
   * caller's concern: `crypto.subtle` is async and unavailable in the pure
   * node test environment, so pulling it in here would break ADR-004. The
   * caller loads allowlist entries from storage (async, once) and supplies a
   * synchronous predicate closed over them. Wired up in milestone 0.0.6.0.
   */
  isAllowlisted?: (value: string) => boolean;
  /** Placeholder rendering. Defaults to `bracketed`. */
  placeholderStyle?: PlaceholderStyle;
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
