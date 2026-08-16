# Bug Fix 0003: Health reports "healthy" after falling back to a guess

**Status**: resolved
**Priority**: HIGH
**Date Created**: 2026-08-16
**Date Started**: 2026-08-16
**Date Resolved**: 2026-08-16
**Branch**: `syamalatha-081526-0.6.0.4-ext`
**Version**: 0.6.0.4

---

## Summary

The health layer graded a composer resolved through a last-resort selector as
`healthy`. Because a healthy page stops being polled, the monitor then settled
permanently on that guess — one second after injection, before ChatGPT's real
composer had rendered — and never looked again.

This is the exact failure Milestone 0.5.0.0 was written to eliminate, sitting
inside the code written to eliminate it. The extension reported full protection
while running on a fallback it could not verify was the right element. Every
user on every page load was affected; nobody would have been told.

---

## Steps to Reproduce

1. Load the extension and open chatgpt.com
2. Open DevTools → Console
3. Read the `[APA]` lines emitted at injection

**Expected behavior**: either `protection healthy (via id)` once the real
composer resolves, or a visible degraded notice if it never does.

**Actual behavior**:

```
[APA] content script active v0.6.0.3
[APA] protection healthy (via visible-textarea)
```

`visible-textarea` is the last entry in the ChatGPT composer chain — the generic
fallback — yet it was graded healthy, and polling stopped there.

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

`levelFor()` graded a resolution as degraded only when it came from
`HEURISTIC_COMPOSER_STRATEGIES` — the two shared, platform-agnostic strategies
added in 0.5.0.1.

But each adapter's chain *also* ends with `largest-editable` and
`visible-textarea`. Those name a **shape**, not a platform. They are fallbacks
in everything except where they happen to sit in the file, and the health layer
had no idea they were not precise platform hooks.

Two consequences compounded:

1. Falling back to a guess reported `healthy`, so the user was never told
2. `createHealthMonitor` stops polling on `healthy`, so a page that resolved
   badly at second one was never re-examined — including the ordinary case of an
   SPA that simply had not finished rendering

---

## Affected Files

| File | Change Description |
|---|---|
| `lib/adapters/heuristic.ts` | Added `FALLBACK_STRATEGY_NAMES`, covering the heuristics plus `largest-editable` and `visible-textarea` |
| `lib/health/index.ts` | `isHeuristic` → `isFallback`, graded against the wider set |
| `lib/health/health.test.ts` | Cases for the generic fallbacks, and one reproducing the live upgrade sequence |

---

## Fix Plan

- [x] Diagnose and confirm root cause from live console output
- [x] Widen what counts as a fallback resolution
- [x] Assert the self-upgrade path
- [x] Re-run the suite and the end-to-end journeys

---

## Testing

**How to verify the fix:**

1. `npm run build`, reload the unpacked extension, open chatgpt.com
2. Console should now show `protection degraded (via visible-textarea)` if the
   composer has not rendered yet, followed by `protection healthy (via id)`
   once it has
3. A page where the composer never resolves still shows the unavailable notice

**Regression concerns**: grading fallbacks as degraded means the monitor keeps
polling in more cases. That is the intended behaviour — it is what lets the page
recover — but it costs a few extra `checkHealth` calls on a slow-rendering page,
bounded by `BACKOFF_MS`.

---

## Resolution Notes

The fix is one line of grading, and it repairs both halves at once. Marking
fallbacks as degraded means the user is told the ground has moved **and** the
monitor keeps checking, so it upgrades itself to `healthy` the moment the real
composer appears. No new retry logic was needed; the existing backoff already
did the right thing once the level stopped lying.

Worth recording how this was found: not from a symptom, but from reading the
console while investigating something else entirely (`Bug_0002`). Nothing was
visibly broken — the extension was protecting the page. The bug was that it
could not have told anyone if it had stopped.

**Related**: `Bug_0002`, found in the same session. Both argue that the beta's
value is in usage rather than in more tests written against our own assumptions.
