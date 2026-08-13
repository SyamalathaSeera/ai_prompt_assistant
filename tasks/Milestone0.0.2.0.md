# Milestone 0.0.2.0 - Detector Engine and Labeled Corpus

**Version:** 0.0.2.0
**Date Created:** 2026-08-12
**Date Started:** 2026-08-12
**Date Completed:** 2026-08-12
**Status:** Complete
**Based on:** ARCHITECTURE.md ADR-004, PRD success criteria

Build the pure detection engine and the labeled corpus that measures it. This milestone
is the product — everything else is delivery mechanism.

---

## Version Information

**Current Version (at milestone start):** `0.0.1.5` (confirmed from package.json, 2026-08-12)
**Target Version:** `0.0.2.6`
**Git Branch:** `syamalatha-081226-0.0.2.0-ext` (created from `main` @ `528e854`)

---

## Progress Summary

**Completion:** 7 of 7 tasks complete (100%)

| Task                                       | Priority | Status  | Version | Verified |
| ------------------------------------------ | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization           | SETUP    | Complete | 0.0.2.0 | branch ✓ |
| Task 1: Engine core and Finding model      | CRITICAL | Complete | 0.0.2.1 | 33 tests ✓ |
| Task 2: High-tier rules (structured secrets)| CRITICAL | Complete | 0.0.2.2 | 92 tests ✓ |
| Task 3: Validators (Luhn, entropy, checksum)| HIGH    | Complete | 0.0.2.3 | 147 tests ✓ |
| Task 4: Low-tier rules (soft PII)          | MEDIUM   | Complete | 0.0.2.4 | 181 tests ✓ |
| Task 5: Labeled corpus + metrics harness   | CRITICAL | Complete | 0.0.2.5 | gate live ✓ |
| Task 6: Placeholder generation + allowlist | HIGH     | Complete | 0.0.2.6 | 212 tests ✓ |

---

## Overview

**Objective:** `detect(text, settings) -> Finding[]`, measurably good, running in
under 50ms on a 10KB input, with no DOM or I/O anywhere in the module.

**Scope:**
- Rule model, engine, overlap resolution
- High- and low-confidence rule families
- Validators that suppress false positives
- Labeled corpus with precision/recall reported as a test gate
- Deterministic placeholder generation

**Estimated Effort:** 4–6 hours

**Dependencies:** 0.0.1.0 (module skeleton and Vitest)

---

## Git Workflow Policy

Standard. Claude writes and tests; the developer commits and pushes. Branch creation is
the only git exception.

---

## Task 0: Milestone Initialization (SETUP)

**Status:** Complete (2026-08-12)

Read version from `package.json`, confirm `0.0.2.0`, create
`syamalatha-081226-0.0.2.0-ext`, record Date Started.

### Outcome

- Version at start confirmed `0.0.1.5`; milestone opens at `0.0.2.0`
- Milestone 0.0.1.0 merged to `main` via PR #1 (`528e854`) and pulled locally before
  branching, so this branch starts from a trunk that actually contains the scaffold
- Branch `syamalatha-081226-0.0.2.0-ext` created from `main`
- Push deferred to milestone end, per the cadence agreed in 0.0.1.0

> Note for future Task 0s: local `main` must be checked out *and* pulled before
> branching. Pulling while a feature branch is active does not advance `main`, which
> silently produces a branch based on a stale trunk.

---

## Task 1: Engine Core and Finding Model (CRITICAL)

**Version:** 0.0.2.1

### Description

The rule abstraction and the scan loop. Get this shape right — every rule written
afterward depends on it.

### Implementation Steps

1. Define `Rule`:
   ```ts
   interface Rule {
     id: string;                    // 'aws.access_key_id'
     label: string;                 // 'AWS Access Key ID'
     tier: 'high' | 'low';
     pattern: RegExp;               // global, sticky-safe
     validate?: (match: string, ctx: MatchContext) => boolean;
     placeholder: (index: number) => string;
   }
   ```
2. Implement `engine.ts`: run all enabled rules, collect raw matches, then resolve.
3. **Overlap resolution**: when two rules match overlapping spans, prefer `high` tier,
   then the longer span, then the earlier rule id. Deterministic and documented.
4. Never attach the matched value to `Finding` — callers slice from source text.

### Testing

- [x] Overlapping matches resolve deterministically (both orderings assert equality)
- [x] Engine imports and runs in the Node `lib` project with no DOM
- [x] Empty, huge (240KB), unicode, whitespace-only input all handled without throwing
- [x] `npm run typecheck` and `npm run lint` pass (exit 0)

### Success Criteria

- [x] Adding a rule requires one new file under `rules/` plus one registry entry
- [x] `Finding` carries no secret material (asserted by serializing and searching)

### Outcome (2026-08-12)

**33 tests, all in the DOM-free `lib` project.** Rules are injected via an optional third
parameter to `detect()`, so the engine's contract is tested independently of whichever
rules exist — these tests stay meaningful through Tasks 2 and 4.

**Design decision — `DetectOptions.allowlistHashes` replaced by `isAllowlisted`.**
The original shape required the engine to hash candidate values to compare against
stored hashes. `crypto.subtle` is async and unavailable in the pure node environment, so
that would have broken ADR-004 or forced a hand-rolled sync hash into the detector.
Instead the caller — which already has storage access and can be async — supplies a
synchronous predicate closed over the loaded allowlist. The detector stays pure and
hash-agnostic; milestone 0.0.6.0 owns the hashing strategy.

**Design decision — a throwing validator keeps the match.** A validator that throws is a
bug, and the engine cannot know what it would have decided. Suppressing the candidate
would mean a possible undetected secret; keeping it means a possible false positive.
For a tool whose entire purpose is preventing leaks, the leak is the worse outcome, so
the engine fails toward detection. The same reasoning applies to a throwing allowlist
predicate. Both paths are tested. The corpus suite in Task 5 is what would catch a
validator throwing routinely.

**Design decision — no input size cap in the engine.** Silently truncating a long
prompt would mean silently failing to detect, which is the one failure this product
cannot have. Pathological input is handled at the interception layer (0.0.3.4), where
the user can be told, and performance work is 0.2.0.4.

**Overlap precedence** is a total ordering — tier, then span length, then rule id, then
start offset — with no reliance on input order, rule registration order, or sort
stability. A test asserts forward and reverse rule ordering produce identical output.
The precedence tests were deliberately built so each distinguishes exactly one rule:
ids are chosen so that if tier or length comparison broke and precedence fell through to
the id, the test would fail rather than pass for the wrong reason.

**Regex safety.** Each rule's pattern is cloned per scan with the global flag ensured.
Rules are module-level singletons, so sharing their RegExp objects would leak
`lastIndex` between calls and drop matches on alternate scans — tested explicitly with
three consecutive calls. Non-global patterns are also accepted and still find all
matches. Zero-length matches are skipped rather than emitted as degenerate findings.

**Placeholder numbering** collapses repeats: the same value appearing three times yields
one placeholder, numbered per rule. Implemented here rather than in Task 6 because
`Finding.placeholder` requires it. Task 6 retains `applyRedactions` and the allowlist
storage format.

**Scope note:** `redact()` remains a stub for Task 6.

---

## Task 2: High-Tier Rules (CRITICAL)

**Version:** 0.0.2.2

### Description

Structured secrets with shapes precise enough that a false positive is close to
impossible. These block submission, so the bar is precision, not coverage.

### Rule families

| Family | Examples |
|---|---|
| Cloud keys | AWS access key id (`AKIA…`), AWS secret (contextual), GCP `AIza…` |
| Vendor tokens | OpenAI `sk-`, Anthropic `sk-ant-`, GitHub `ghp_`/`gho_`/`ghs_`/`github_pat_`, Slack `xox[baprs]-`, Stripe `sk_live_`/`rk_live_` |
| Crypto material | PEM headers (`-----BEGIN … PRIVATE KEY-----`), SSH private keys |
| Structured creds | `postgres://`, `mysql://`, `mongodb+srv://` with credentials; `.env` assignment lines |
| Auth artifacts | JWTs (three base64url segments, decodable header) |
| Financial | Card numbers gated on Luhn (Task 3) |

### Implementation Steps

1. One file per family under `lib/detector/rules/`.
2. Every rule ships with at least three positive and three negative fixtures.
3. Prefer prefix-anchored patterns over generic entropy for anything in this tier.

### Testing

- [x] Every rule has positive and negative cases
- [x] No high-tier rule fires on any of the 16 clean developer-text samples
- [x] `npm run typecheck` and `npm run lint` pass (exit 0)

### Success Criteria

- [x] 92 tests passing; precision measured properly against the full corpus in Task 5

### Outcome (2026-08-12)

**16 rules across 6 families**, one file per family:

| File | Rules |
|---|---|
| `cloud.ts` | AWS access key id, AWS secret (contextual), Google API key |
| `vendor.ts` | Anthropic, OpenAI, GitHub classic + fine-grained, Slack, Stripe live, SendGrid |
| `crypto-material.ts` | PEM private key block, unterminated header, PuTTY key |
| `connection-strings.ts` | DB/broker URI password |
| `env-assignments.ts` | Secret-shaped config assignment |
| `jwt.ts` | JSON Web Token with decoded-header validation |

**Engine extension — `captureGroup`.** Two rules need surrounding context to be
precise but must redact only part of the match. The PRD requires redactions to preserve
enough context for the model to understand the task, so `DB_PASSWORD=[REDACTED_1]` and
`postgres://app:[REDACTED_1]@db.internal/orders` are materially better than replacing
the whole line. Implemented with the regex `d` flag, which exposes per-group offsets.

**Engine extension — `specificity`, found by a failing test.** The realistic `.env`
fixture exposed a genuine defect: `STRIPE_SECRET_KEY=sk_live_…` matched both the generic
config rule and the specific Stripe rule over an identical span. Same tier, same length,
so the tie fell to rule id — arbitrary, and the generic rule won. The secret was still
redacted, but the user would be told "Secret in Configuration" instead of "Stripe Live
Key" in what is probably the single most common real-world case.

Precedence is now: tier → **specificity** → span length → rule id → start offset.
Specificity sits above length deliberately: naming the exact credential that leaked is
worth more than redacting one character further. Generic keyword fallbacks sit at -1;
prefix-anchored vendor rules keep the 0 default. Regression tested both directions.

**Precision decisions worth recording:**

- *AWS secret keys* are anchored on the `aws_secret_access_key` key name. A bare 40-char
  base64 string is indistinguishable from a checksum or hash, so the unanchored form is
  not detectable at high-tier precision. Tested that a bare one does **not** fire.
- *PEM rules match the entire armoured block*, header through footer. Matching only the
  `-----BEGIN` line would redact the label and leave the key body in the prompt — a
  redaction that appears to work while leaking everything. A separate rule catches an
  unterminated header, since half a pasted key file is still a leak.
- *Stripe test keys are excluded* from the high tier. They cannot move money, so blocking
  submission over one is exactly the false alarm that drives uninstalls.
- *JWTs are validated by decoding the header* and confirming it parses as JSON with an
  `alg` field. Three dot-separated base64 runs is a shape random data can hit; a
  decodable header is not. Uses a hand-rolled base64url decoder rather than `atob`, so
  the detector depends on no ambient platform API and ADR-004 stays checkable.
- *The config-assignment rule* is the loosest and is constrained on three axes: a
  secret-ish key name, a value containing no code syntax (`$`, brackets, backticks,
  template markers), and enough distinct characters to not be padding. Negative tests
  cover `$MY_TOKEN`, `getAuthToken()`, `{{ vault_token }}`, and `xxxxxxxxxxxx`.

**Negative corpus: 16 clean developer-text samples** — git SHAs, UUIDs, semver lists,
stack traces, base64 image data, SQL, Docker refs, Windows paths, a 16-digit number —
all assert **zero** findings. These are the tests that protect retention; Task 5 grows
this into the full measured corpus.

**Deferred to Task 3:** credit cards. A 16-digit pattern without the Luhn gate would
have unacceptable precision, so the family lands with its validator rather than before it.

---

## Task 3: Validators (HIGH)

**Version:** 0.0.2.3

### Description

The suppression layer. This is where most false-positive risk is removed.

### Implementation Steps

1. `luhn(value)` — gate all card matches.
2. `shannonEntropy(value)` — gate generic "high entropy string near a secret keyword"
   rules, which are the most dangerous rules in the system.
3. `isLikelyPlaceholder(value)` — suppress `your-api-key-here`, `xxx…`, `<REDACTED>`,
   `sk-test-…`, repeated characters, and values already matching our own placeholder
   format. Users paste documentation snippets constantly.
4. `isInCodeFence(ctx)` — context helper; a value inside a fenced block is not
   automatically safe, but it informs tier for some families.

### Testing

- [x] Luhn accepts known-valid numbers, rejects transpositions and sequential runs
- [x] Documentation-style dummy keys are suppressed (12 placeholder forms tested)
- [x] Our own placeholders never re-detect — full idempotence test on a 4-secret document
- [x] `npm run typecheck` and `npm run lint` pass (exit 0)

### Success Criteria

- [x] Re-running detection on already-redacted text produces zero findings

### Outcome (2026-08-12)

**147 tests** (was 92). Validators implemented: `luhn`, `shannonEntropy`,
`isLikelyPlaceholder`, `isInCodeFence`, plus the character-variety helpers moved here
from `rules/shared.ts` so `validators.ts` is their canonical home per ARCHITECTURE.md.

**The placeholder gate is applied universally**, composed into every rule by
`defineRule` rather than opted into per rule. A real credential never looks like
`your-api-key-here`, so the check costs nothing and removes a whole class of false
positive at once. `skipPlaceholderCheck` opts out the PEM block rule, where heuristics
aimed at short values are meaningless against a multi-line armoured block.

**Design constraint — the phrase list is built only from long, distinctive strings.**
Suppressing a real secret is a leak, which is the one failure this product cannot have,
so every entry is 7+ characters (`changeme`, `keygoeshere`, `examplekey`). Short markers
like `test` or `key` were deliberately excluded: they would suppress genuine credentials
that happen to contain them. Tested explicitly — `testKeyR9xK2mQ7vL4nP8w` is **not**
suppressed.

**A failing test exposed a bad fixture, not a bad validator.** Three tests failed
because AWS's documentation example secret `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`
ends in `EXAMPLEKEY` and was correctly suppressed as a placeholder. The fixture was
wrong, not the code: a published documentation placeholder cannot stand in for a real
credential. Replaced with a synthetic 40-character value, and AWS's example was moved
into the placeholder-rejection tests where it belongs. Users paste AWS docs constantly,
so suppressing it is a genuine precision win.

**Payment cards (deferred from Task 2) now land with three independent gates:**

| Gate | Removes |
|---|---|
| Luhn checksum | ~90% of random digit runs |
| Recognised issuer prefix | Luhn-valid order numbers and identifiers |
| Published test-card list | Stripe/Visa/Amex documentation numbers |

The test-card exclusion matters more than it looks: `4242424242424242` appears in
sample code and test suites everywhere, and flagging it is a pure false positive. Note
the distinct-character check is **not** applied to cards — real card numbers legitimately
repeat digits, and applying it would have rejected valid ones.

**Idempotence is now proven end to end.** A four-secret document is detected, redacted
by applying placeholders right-to-left, and re-scanned — the second pass returns zero
findings. Structure survives intact:
`AWS_ACCESS_KEY_ID=[REDACTED_AWS_ACCESS_KEY_ID_1]`. This is the property Task 6's
`applyRedactions` and the 0.0.5.0 vault both depend on.

---

## Task 4: Low-Tier Rules (MEDIUM)

**Version:** 0.0.2.4

### Description

Soft PII. Suggest, never block. Default-on for email/phone; default-off for the noisier
families.

### Rule families

Email, phone (E.164 and common national formats), IPv4/IPv6, street address,
SSN/national ID, and internal-looking hostnames.

**Person names are deliberately excluded from v1.** Name detection without an NER model
is a false-positive generator, and a tool that flags the user's own name in every prompt
gets uninstalled. Revisit only with an on-device model.

### Testing

- [x] Every PII rule is low tier, asserted directly against the rule definitions
- [x] Default-off families are off in `defaults.ts`, sourced from the rules themselves
- [x] Default settings stay silent on IP addresses, internal hosts, and addresses
- [x] `npm run typecheck` and `npm run lint` pass (exit 0)

### Success Criteria

- [x] Low-tier noise is opt-in beyond email, phone, and SSN

### Outcome (2026-08-12)

**181 tests** (was 147). Six PII rules, all low tier:

| Rule | Default | Notes |
|---|---|---|
| `pii.email` | on | documentation domains suppressed |
| `pii.phone` | on | E.164 and separator-delimited national forms |
| `pii.ssn` | on | hyphenated only, SSA-invalid ranges rejected |
| `pii.ipv4` | **off** | version strings are indistinguishable from addresses |
| `pii.internal_hostname` | **off** | `.internal`, `.corp`, `.lan`, `.local` |
| `pii.street_address` | **off** | noisiest rule in the project |

**Person names remain excluded**, as planned in the milestone. Detecting them without an
NER model means matching capitalised words, which fires on every proper noun in every
prompt. A test asserts a sentence full of names produces zero findings.

**SSN ships default-on — a deliberate deviation from "email and phone only".** The
hyphenated 3-2-4 shape is specific, SSA-invalid ranges are rejected, and the harm from
leaking one is high. Because it is low tier it can only ever suggest, never block, so a
rare false suggestion is a good trade for catching a real one.

**A bare ten-digit run is not treated as a phone number.** It is indistinguishable from
an order number or identifier, and the noise would swamp the real hits. Only E.164 and
separator-delimited forms match.

**IPv4 is off by default because of a genuine ambiguity, not laziness.** `0.0.2.3` is
this project's own version string *and* a syntactically valid IPv4 address — nothing in
the shape distinguishes them. The rule rejects any quad whose octets are all single
digits, plus explicit `v`/`version` markers. That loses `8.8.8.8` and `1.2.3.4`, neither
of which is sensitive, and keeps the common private ranges that actually reveal internal
topology.

**Defaults are sourced from the rule definitions.** `DEFAULT_DISABLED_RULE_IDS` is
exported from the rules and consumed by `defaults.ts`, so the shipped experience and the
rule set cannot drift apart. A test asserts they match.

**A failing test caught an outdated assertion.** The realistic `.env` fixture from Task 2
asserted every finding was high tier; it now also contains `db.internal`, which is a
genuine low-tier hostname finding. The detection was correct and the assertion was stale
— rewritten to assert the three credentials are blocking and the hostname is advisory,
which is a more meaningful check than the original.

---

## Task 5: Labeled Corpus and Metrics Harness (CRITICAL)

**Version:** 0.0.2.5

### Description

The gate. Without measurement, detection quality is a guess, and detection quality is
the entire product.

### Implementation Steps

1. `test/corpus/positive/` — realistic documents that contain planted synthetic secrets
   with labeled spans: stack traces, `.env` files, docker-compose, terraform, Django
   settings, a support email thread.
2. `test/corpus/negative/` — realistic documents that must produce **zero** high-tier
   findings: normal code, API documentation with dummy keys, base64 images, UUIDs, git
   SHAs, minified JS, lorem ipsum.
3. A Vitest suite that computes precision, recall, and F1 per tier and prints a table.
4. Fail the suite when high-tier precision < 0.98 or recall < 0.90.
5. A benchmark test asserting < 50ms on a 10KB input.

### Testing

- [x] Metrics table prints on `npm run test`
- [x] Thresholds fail the build when breached — **observed twice during this task**, not
      simulated (see below)
- [x] 10KB benchmark enforced
- [x] `npm run typecheck` and `npm run lint` pass (exit 0)

### Success Criteria

- [x] PRD quality gates mechanically enforced as failing tests
- [x] Negative corpus has 24 realistic documents, exceeding the 20 required

### Outcome (2026-08-12)

**188 tests.** Current measurement:

```
documents       10 positive, 24 negative
true positives  19
false positives  0
false negatives  0

precision       100.0%   (gate 98.0%)
recall          100.0%   (gate 90.0%)
F1              100.0%

10KB scan       0.4ms    (budget 50ms)
```

**Read 100% with suspicion, not satisfaction.** These are documents we wrote ourselves,
so the detector is being graded on its own homework. The number that will matter is the
one from milestone 0.9.0.0, measured against material real users paste. The corpus is
built to absorb those cases: every false positive reported in beta gets added to
`negative.ts` *before* it is fixed, so each fix is regression-tested permanently.

**The gate proved itself during this task rather than in a contrived mutation test.**
It failed twice on first run, and both failures were real:

1. *Precision 94.7%* — the terraform document genuinely contains two secrets
   (`access_key` and `secret_key`) and only one was labelled. The detector found the
   unlabelled one; the corpus was wrong.
2. *Misattribution* — the synthetic SendGrid key had an 18-character middle segment
   where the real format is 22, so the SendGrid rule correctly declined and the generic
   rule caught it. Again the fixture was wrong, not the rule.

Both were corpus defects rather than detector defects, which is the outcome to hope for
at this stage.

**Labels are keyed by value, not by character offset.** Offsets go stale the moment a
document is edited, and a corpus nobody dares edit stops growing — which would defeat
its entire purpose.

**Four separate gates**, so a regression is attributable rather than just "the number
moved": precision, recall, zero-high-tier-on-negatives, and correct rule attribution.
Attribution is not a leak gate — the value is redacted either way — but a misattribution
means telling the user the wrong thing about what leaked.

**Failure output is masked.** A failing assertion prints `wR2vX9…4vL8`, never a whole
value. The corpus holds only synthetic secrets, but a tool that prints secrets into CI
logs on failure would be teaching the wrong habit.

**Performance is 125× inside budget** — 0.4ms against a 50ms allowance on 10KB, with a
separate 100KB test guarding against a rule with catastrophic backtracking slipping in.

---

## Task 6: Placeholder Generation and Allowlist (HIGH)

**Version:** 0.0.2.6

### Description

Placeholders must preserve enough shape for the model to still reason about the task,
and must be stable within a single prompt.

### Implementation Steps

1. Format: `[REDACTED_<TYPE>_<N>]`, N stable per distinct value within one scan, so the
   same key appearing three times maps to one placeholder.
2. Optional "realistic dummy" mode (`dummy_api_key_1`) for cases where a bracketed token
   confuses the model — configurable, bracketed is the default.
3. `applyRedactions(text, findings)` returning `{ text, map }`, where `map` feeds the
   vault in 0.0.5.0. Apply right-to-left by offset so earlier offsets stay valid.
4. Allowlist: hash values (never store plaintext) and suppress matching findings.

### Testing

- [x] Repeated values collapse to one placeholder
- [x] Redaction applied right-to-left produces correct output on multi-finding text
- [x] Allowlisted value produces no finding, in every occurrence
- [x] Allowlist stores no plaintext (asserted by searching the serialised list)
- [x] `npm run typecheck`, `npm run lint`, `npm run build` all pass

### Success Criteria

- [x] `detect → redact → detect` yields zero findings
- [x] Redacted prompts remain intelligible — `AWS_ACCESS_KEY_ID=[REDACTED_AWS_ACCESS_KEY_ID_1]`

### Outcome (2026-08-12)

**212 tests.** Corpus metrics unchanged: precision 100%, recall 100%, 0.4ms on 10KB.

**Placeholder construction moved out of the rules into the engine.** `Rule` now carries
a `token` string and `formatPlaceholder(token, index, style)` builds the final text.
Previously each rule closed over its own format string, which meant the `dummy` style
could not be supported without touching every rule — and worse, placeholder shape lived
in sixteen places while `isLikelyPlaceholder` had to recognise all of them. One source
of truth is what keeps idempotence honest. Both styles are now recognised by the
placeholder gate, tested in both directions.

**A failing test caught a partial-leak bug in `redact()`.** The first implementation
resolved overlapping findings by keeping whichever came first in right-to-left order,
which is arbitrary — and on the test input it kept the *inner* span. Redacting an inner
span leaves the surrounding characters of the outer value in the prompt, which is a
partial leak rather than a formatting glitch. Overlaps are now resolved by preferring
the wider span before substitution. `detect()` already resolves overlaps, so this only
guards hand-assembled input, but it is exactly the kind of guard that should not be
wrong.

**Redaction applies right-to-left**, reading values from the original text since offsets
refer to it. A left-to-right implementation corrupts every offset after the first
substitution whenever a placeholder differs in length from the value it replaces —
tested directly with three secrets in one string.

**The allowlist lives in `lib/policy/`, not in the detector.** Hashing needs
`crypto.subtle`, which is asynchronous and a platform API; importing it into
`lib/detector/` would break ADR-004 and make the corpus suite untestable outside a
browser. Suppression therefore happens *around* the detector — `detect()` stays
synchronous and pure, and findings are filtered afterwards. Filtering after the scan is
also cheaper: findings are few, whereas hashing every candidate mid-scan would put an
async boundary on the hot path the live risk badge depends on.

**Entries are SHA-256 hex digests; plaintext never reaches storage.** The allowlist must
not itself become a place secrets accumulate — that is the failure mode this product
exists to prevent. The consequence, accepted deliberately: the options UI can list and
delete entries but can never display them, and it will say so.

**`detectAndRedact()`** added as a convenience wrapper returning findings alongside the
redacted text, so the approval UI in 0.0.4.0 does not scan twice.

---

## Session Notes

_(Record rule tuning decisions and corpus additions here.)_

---

**End of Milestone 0.0.2.0 Specification**
