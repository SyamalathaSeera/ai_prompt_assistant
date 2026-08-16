# Bug Fix 0002: Password written in a sentence is never detected

**Status**: resolved
**Priority**: HIGH
**Date Created**: 2026-08-16
**Date Started**: 2026-08-16
**Date Resolved**: 2026-08-16
**Branch**: `syamalatha-081526-0.6.0.4-ext`
**Version**: 0.6.0.4

---

## Summary

`env.secret_assignment` is anchored to the start of a line, so a secret written
mid-sentence is invisible to it. A real draft on chatgpt.com —
`deploy with AKIA… and password: Syam_123*` — had the AWS key caught and the
password sent through untouched. This is the product's core job failing on the
most ordinary phrasing there is: a person typing a sentence rather than pasting
a config file. Every user is affected, on every prompt where they mention a
credential in prose.

Found by using the extension, not by reading it. The labelled corpus reported
100% precision and 100% recall while this was live, because every config sample
in it put assignments at the start of a line — which is exactly what the rule
required. **The corpus and the rule agreed with each other, so neither noticed.**

---

## Steps to Reproduce

1. Load the extension and open chatgpt.com
2. Type: `deploy with AKIA3TZ2MRSYNTHETIC7 and password: Syam_123*`
3. Press Enter

**Expected behavior**: both the AWS key and the password are reported.

**Actual behavior**: only the AWS key is reported. The password is sent in clear
text.

Note the ordering dependence, which is what made the anchor obvious:

| Draft | Result |
|---|---|
| `password: Syam_123* AKIA3TZ2MRSYNTHETIC7` | both found |
| `deploy with AKIA3TZ2MRSYNTHETIC7 and password: Syam_123*` | key only |
| `my password: Syam_123*` | nothing found |
| `AWS Password- Syam_123*` | nothing found |

---

## Environment

| Detail | Value |
|---|---|
| Browser / Client | Chrome (unpacked, `.output/chrome-mv3`) |
| OS | Windows 11 |
| Deployed URL | https://chatgpt.com |
| Commit / Version | 0.6.0.3, `80a9161` |

---

## Root Cause

The rule's pattern opens with `(?:^|[\r\n])`:

```
/(?:^|[\r\n])[ \t]*(?:export[ \t]+)?[A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSWORD|…)…/
```

That anchor is deliberate and correct *for what the rule was built for* —
`.env` files, config blocks, shell exports — where it is the main thing keeping
a loose, keyword-driven rule precise enough to sit in the blocking tier.

It was never wrong; it was incomplete. Nothing covered the same keywords
appearing in prose, and prose is what a chat window is for.

---

## Affected Files

| File | Change Description |
|---|---|
| `lib/detector/rules/env-assignments.ts` | Added `env.inline_secret`: same keywords, no line anchor, LOW tier |
| `test/corpus/positive.ts` | 3 cases covering sentence, dash, and inline-token phrasings |
| `test/corpus/negative.ts` | 3 counterweight cases that mention secret words without containing one |
| `e2e/journeys.spec.ts` | 2 regression tests driving the real build with the original draft |

---

## Fix Plan

- [x] Diagnose and confirm root cause
- [x] Decide the tier (see below)
- [x] Implement `env.inline_secret`
- [x] Add positive AND negative corpus cases
- [x] Verify against the real built extension end to end

---

## Testing

**How to verify the fix:**

1. `npm run build`, reload the unpacked extension
2. Type `deploy with AKIA3TZ2MRSYNTHETIC7 and password: Syam_123*` into ChatGPT
3. The AWS key appears as blocking; the password appears in the advisory
   section below it
4. "Use redacted version" removes both

**Regression concerns**: this rule is deliberately looser than anything else in
the registry. The negative corpus grew alongside it and must keep growing —
every false positive reported from beta belongs in `test/corpus/negative.ts`
before it is fixed.

---

## Resolution Notes

**LOW tier, chosen deliberately.** Dropping the line anchor buys recall and
costs certainty: `your password: must be at least twelve characters` contains no
secret, and nothing in the pattern can tell it from one that does. Under the
rule stated in `lib/detector/rules/index.ts` — a rule belongs in the high tier
only if firing on innocent text would be a *bug* — that disqualifies it from
blocking. It warns, the message still goes, and the user decides. Being wrong
while blocking is the fastest route to an uninstall.

**A false positive was introduced and caught during the fix.** The first version
accepted `-` as a separator, so `<your-secret-access-key>` parsed as the key
`secret` assigned the value `access-key` — a documentation placeholder becoming
a finding. The existing placeholder tests caught it immediately. Fixed by
requiring whitespace after the dash: `Password- hunter2pass` has it,
`secret-access-key` does not. The placeholder file is now a negative corpus
case, so it cannot come back.

Not filed as its own bug: it never shipped, and it belongs to this change.

**Metrics after the fix**: 13 positive documents, 27 negative, precision 100%,
recall 100%, 1263 unit tests, 14 end-to-end.

**Related**: found during manual testing of Milestone 0.6.0.0. The lesson —
that a self-authored corpus can agree with the rule it is meant to check — is
the strongest argument yet for the beta being about *usage* rather than more
test-writing. See also `Bug_0003`, found in the same session.

---

## Redaction Bug Addendum

| Field | Value |
|---|---|
| Rule ID | `env.secret_assignment` (gap) → `env.inline_secret` (new) |
| Failure type | False negative |
| Synthetic repro value | `password: Syam_123*` inside a sentence |
| Corpus fixture added | [x] yes, at `test/corpus/positive.ts` and `negative.ts` |
