# Milestone 0.0.2.0 - Detector Engine and Labeled Corpus

**Version:** 0.0.2.0
**Date Created:** 2026-08-12
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** ARCHITECTURE.md ADR-004, PRD success criteria

Build the pure detection engine and the labeled corpus that measures it. This milestone
is the product — everything else is delivery mechanism.

---

## Version Information

**Current Version (at milestone start):** `0.0.1.5`
**Target Version:** `0.0.2.6`
**Git Branch:** `syamalatha-MMDDYY-0.0.2.0-ext`

---

## Progress Summary

**Completion:** 0 of 7 tasks complete (0%)

| Task                                       | Priority | Status  | Version | Verified |
| ------------------------------------------ | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization           | SETUP    | Pending | 0.0.2.0 | -        |
| Task 1: Engine core and Finding model      | CRITICAL | Pending | 0.0.2.1 | -        |
| Task 2: High-tier rules (structured secrets)| CRITICAL | Pending | 0.0.2.2 | -        |
| Task 3: Validators (Luhn, entropy, checksum)| HIGH    | Pending | 0.0.2.3 | -        |
| Task 4: Low-tier rules (soft PII)          | MEDIUM   | Pending | 0.0.2.4 | -        |
| Task 5: Labeled corpus + metrics harness   | CRITICAL | Pending | 0.0.2.5 | -        |
| Task 6: Placeholder generation + allowlist | HIGH     | Pending | 0.0.2.6 | -        |

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

Read version from `package.json`, confirm `0.0.2.0`, create and push
`syamalatha-MMDDYY-0.0.2.0-ext`, record Date Started.

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

- [ ] Overlapping matches resolve deterministically (unit tested both orderings)
- [ ] Engine is importable in a Node test environment with no DOM
- [ ] Empty input, huge input, and unicode input do not throw

### Success Criteria

- Adding a rule requires touching exactly one new file under `rules/`
- `Finding` carries no secret material

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

- [ ] Every rule has positives and negatives in the corpus
- [ ] No high-tier rule fires on the negative corpus (precision 1.00 on that set)

### Success Criteria

- High-tier precision ≥ 0.98 measured in Task 5

> Use only published example/dummy values in fixtures (e.g. `AKIAIOSFODNN7EXAMPLE`).
> Never commit a real key, even a revoked one.

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

- [ ] Luhn accepts known-valid test numbers, rejects near-misses
- [ ] Documentation-style dummy keys are suppressed
- [ ] Our own placeholders never re-detect (idempotence: `detect(redact(x))` is empty for high tier)

### Success Criteria

- Re-running detection on already-redacted text produces no high-tier findings

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

- [ ] Low-tier findings never set the blocking flag
- [ ] Default-off families are off in `defaults.ts`

### Success Criteria

- Low-tier noise is opt-in beyond email/phone

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

- [ ] Metrics table prints on `npm run test`
- [ ] Thresholds fail the build when breached (verify by temporarily loosening a rule)

### Success Criteria

- PRD quality gates are mechanically enforced, not aspirational
- Negative corpus contains at least 20 realistic documents — this set is what protects retention

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

- [ ] Repeated values collapse to one placeholder
- [ ] Redaction applied right-to-left produces correct output on multi-finding text
- [ ] Allowlisted value produces no finding
- [ ] Allowlist stores no plaintext

### Success Criteria

- `detect → redact → detect` yields zero high-tier findings
- Redacted prompts remain intelligible to a reader

---

## Session Notes

_(Record rule tuning decisions and corpus additions here.)_

---

**End of Milestone 0.0.2.0 Specification**
