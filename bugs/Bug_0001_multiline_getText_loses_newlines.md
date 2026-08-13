# Bug Fix 001: Multi-line prompts read with line breaks erased

**Status**: resolved
**Priority**: CRITICAL
**Date Created**: 2026-08-13
**Date Started**: 2026-08-13
**Date Resolved**: 2026-08-13
**Branch**: `syamalatha-081326-0.0.6.0-ext`
**Version**: 0.0.6.4

---

## Summary

`chatgptAdapter.getText()` read the composer with `textContent`, which
concatenates block elements with **no separator**. ProseMirror renders each
line of the composer as its own `<p>`, so a multi-line prompt came back with
every line boundary erased:

```
pasted:  AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
         DATABASE_URL=postgres://app:hunter2pass@db.internal:5432/orders

read as: AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLEDATABASE_URL=postgres://...
```

Most detection rules are anchored with `\b`, so a secret at the end of a line
was glued to the start of the next one and stopped matching. **The secret was
silently not detected.**

The impact is squarely in the product's primary use case: pasting a `.env`
file, a config block, or a stack trace. Any secret on a line followed by
another line was missed, with no indication anything had gone wrong.

---

## Steps to Reproduce

1. Load the extension and open ChatGPT
2. Paste two lines into the composer:
   ```
   AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
   DATABASE_URL=postgres://app:hunter2pass@db.internal:5432/orders
   ```
3. Observe the risk badge

**Expected**: "2 to redact" — the AWS key and the database password.

**Actual**: "1 to redact". Only the password was found; the AWS key was
missed because `AKIAIOSFODNN7EXAMPLE` was read as
`AKIAIOSFODNN7EXAMPLEDATABASE_URL` and failed its trailing word boundary.

---

## Environment

| Detail | Value |
|---|---|
| Browser | Chrome, Windows 11 |
| Deployed URL | chatgpt.com, extension loaded unpacked |
| Version | 0.0.6.3 (found), 0.0.6.4 (fixed) |

---

## Root Cause

`textContent` on a container joins the text of its children without
separators. It is the right reading for a flat contenteditable and the wrong
one for a block-structured editor.

**Why 620 passing tests did not catch it:** the jsdom fixture built the
composer as a plain `<div>` with flat text assigned to it. Every assertion
about `getText` was correct about the fixture, and the fixture did not
resemble what ChatGPT actually renders. The tests were not weak — they were
faithful to the wrong model.

---

## Affected Files

| File | Change |
|---|---|
| `lib/adapters/chatgpt.ts` | `getText` joins block children with `\n`; falls back to `textContent` when there are none |
| `lib/adapters/chatgpt.test.ts` | Fixture rebuilt to use one `<p>` per line, as ProseMirror does |

---

## Fix Plan

- [x] Confirm the root cause against the live page
- [x] Join block-level children with newlines, keeping the flat fallback
- [x] Rebuild the test fixture to match the real editor's structure
- [x] Add regression tests: multi-line, blank lines, flat contenteditable
- [x] Verify the fix on the live page

---

## Testing

**How the fix was verified:**

1. Unit: a fixture with two `<p>` lines now yields `\n` between them, and
   `/\bAKIA[0-9A-Z]{16}\b/` matches the result
2. Live: the same two-line paste on chatgpt.com produced "2 to redact", and
   redaction returned both lines intact:
   ```
   AWS_ACCESS_KEY_ID=[REDACTED_AWS_ACCESS_KEY_ID_1]
   DATABASE_URL=postgres://app:[REDACTED_DB_PASSWORD_1]@db.internal:5432/orders
   ```

**Regression concerns**: `setText` was unaffected and was separately confirmed
working, including that ProseMirror's internal document stays in sync — so the
redacted text is what actually gets sent.

---

## Resolution Notes

Fixed by reading block children and joining with `\n`. `BLOCK_TAGS` covers
`p`, `div`, `pre`, `blockquote`, `li`, and headings, since a pasted config or
snippet can produce any of them.

**The lesson worth keeping:** this was found in roughly ten minutes of driving
the real page, after five milestones of green tests. A fixture is a claim about
what the world looks like, and this one had never been checked against the
world. Where an adapter mirrors someone else's DOM, the fixture should be built
from an actual observation of that DOM — not from what the code under test
happens to need.

**Related**: found during the dogfooding pass deferred from milestone 0.0.4.0
and repeatedly carried forward. Milestone 0.2.0.5 (Playwright e2e against saved
DOM fixtures) is the systematic version of this check.
