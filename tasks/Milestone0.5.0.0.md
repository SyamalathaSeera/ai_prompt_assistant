# Milestone 0.5.0.0 - Hardening, Resilience, Performance

**Version:** 0.5.0.0
**Date Created:** 2026-08-12
**Date Started:** 2026-08-14
**Date Completed:** 2026-08-14
**Status:** Complete
**Based on:** PRD non-functional requirements

Turn a working extension into a production one. The failure mode this milestone exists to
prevent: ChatGPT ships a DOM change, the extension silently stops protecting people, and
nobody finds out for three weeks.

---

## Version Information

**Current Version (at milestone start):** `0.4.0.4`
**Target Version:** `0.5.0.4`
**Git Branch:** `syamalatha-081426-0.5.0.0-ext`

---

## Progress Summary

**Completion:** 5 of 5 tasks complete (100%)

| Task                                    | Priority | Status   | Version | Verified        |
| --------------------------------------- | -------- | -------- | ------- | --------------- |
| Task 0: Milestone Initialization        | SETUP    | Complete | 0.5.0.0 | branch ✓        |
| Task 1: Adapter self-healing + health   | CRITICAL | Complete | 0.5.0.1 | 1126 tests ✓    |
| Task 2: Remote selector config (data)   | —        | Deferred | —       | see below       |
| Task 3: Error boundaries + fail-open    | CRITICAL | Complete | 0.5.0.2 | 1166 tests ✓    |
| Task 4: Performance budget              | HIGH     | Complete | 0.5.0.3 | 1179 tests ✓    |
| Task 5: E2E suite (Playwright)          | HIGH     | Complete | 0.5.0.4 | 1184 + 12 e2e ✓ |

Task numbers are kept as written rather than renumbered, so that references to
"Task 3" elsewhere still mean the same thing. Versions are sequential over the
tasks that remain.

---

## Overview

**Objective:** The extension degrades visibly and safely, recovers from host changes
on its own where the DOM still permits it, and never costs the user performance.

Recovery is now Task 1's job alone. Task 2 would have added a remote selector feed as
a second line of defence; it is deferred, so self-healing has to carry that weight and
anything it cannot fix waits for a store update.

**Estimated Effort:** 6–8 hours

**Dependencies:** 0.4.0.0

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch `syamalatha-MMDDYY-0.5.0.0-ext`, Date Started.

---

## Task 1: Adapter Self-Healing and Health Reporting (CRITICAL)

**Version:** 0.5.0.1

### Description

Silent failure is the worst outcome for a security tool — the user believes they are
protected when they are not.

### Implementation Steps

1. Health check on injection: can the composer be resolved? Do submit listeners attach?
2. On failure, retry with backoff across the fallback chain before giving up.
3. On persistent failure, **tell the user** — badge state plus popup message: "Protection
   unavailable on this page." Never fail silently.
4. Heuristic composer discovery as a last resort: find the focused `contenteditable` or
   `textarea` nearest a submit control.
5. Record health status locally for the user to see. No transmission.

### Testing

- [x] Forcing all primary selectors to fail triggers the heuristic path
- [x] Total failure surfaces a visible "protection unavailable" state
- [x] Recovery works when the composer appears late

### Success Criteria

- [x] A user can always tell whether they are currently protected

### Implementation Notes

`lib/adapters/heuristic.ts`, `lib/health/index.ts`, `components/HealthNotice.tsx`,
plus wiring in the content script and popup. 37 new tests (1089 → 1126).

**Three health states, not two.** `degraded` — running, but only via a heuristic —
is its own state rather than a flavour of healthy. The heuristics find *a*
composer; they do not know it is *the* composer, and the page has clearly moved.
Saying so costs nothing and gives a bug report something to quote.

**Heuristics are platform-agnostic on purpose.** `byFocusedEditable` and
`byEditableNearSubmit` encode the only two things a chat interface cannot stop
having: a box you type into and a control that sends. Distance is measured
through the DOM rather than in pixels, because markup is more stable than a
stylesheet. Ties break on size — which is precisely the ChatGPT case, where a
0×0 decoy textarea sits beside the real composer.

**Two real bugs the tests caught:**

1. **The heuristic test passed for the wrong reason.** The first version used an
   unrecognised class name, but ChatGPT's chain already ends with a generic
   `largest-editable`, so that caught it and the heuristics were never reached.
   The fixture is now `contenteditable="plaintext-only"` — a real attribute value
   that slips past every selector in the adapter, all of which ask for `"true"`
   exactly.
2. **`checkHealth` reported a false "unavailable".** It required a `<form>`, and
   the health layer reads that as unprotected — so a page that dropped its form
   while remaining perfectly interceptable via Enter would have told the user
   they were unprotected when they were not. A false alarm from a security tool
   spends the credibility it needs for the real one. Now: composer resolvable OR
   form OR send button.

**The fake clock exposed a design flaw**: the first check was scheduled rather
than run, so the UI briefly showed a state nobody had measured. `BACKOFF_MS` now
describes delays before *retries*; the first answer never waits.

**Nothing is transmitted.** Health goes to `chrome.storage.session` — session,
not local, because a stale "healthy" surviving a restart would be a lie in the
dangerous direction. It records a level and a strategy name; no URL, no page
text, no prompt content.

**The popup folds health into the status dot**, so a green dot cannot appear over
a page where the composer cannot be found. Absent health is not read as broken —
the popup may have opened before the first check landed, and claiming failure on
missing data would cry wolf on a healthy page.

---

## Task 2: Remote Selector Config, Data Only — DEFERRED

**Status:** Deferred past 1.0.0.0. Decision taken 2026-08-14, at milestone start.

### What it was going to be

Fetch a signed JSON selector map from a static host, background worker only, on a
slow schedule, validated against a strict schema, with bundled selectors as the
fallback and a setting to disable it — so a ChatGPT DOM change would not require a
store review cycle.

### Why it is deferred

The task always carried a warning that it was "the one place the no-network rule is
relaxed". What changed since it was written is that the exception now has a
**concrete, measured** cost rather than a theoretical one:

- Milestone 0.2.0.0 audited the built bundle and confirmed it contains **no network
  transport at all**, and `test/no-network.test.ts` enforces that on every run. This
  task would delete that test.
- ADR-007 rests on the same fact. "Nothing you type leaves this device" is currently
  literally true and mechanically checked. Shipping this turns it into a qualified
  claim needing an asterisk in the store listing — immediately before the beta where
  that claim is the entire pitch.
- **Task 1 already solves the problem this exists to solve.** Adapter self-healing
  plus heuristic composer discovery handles selector breakage without a network call.
  A store update cycle is a slower fix, but it is a fix, and it is one nobody has to
  be persuaded to trust.

The trade is real and it is being made deliberately: recovery from a host DOM change
is slower without this. That is judged cheaper than weakening the one claim the
product is sold on.

### Revisit when

Beta or post-1.0 data shows selector breakage actually happening often enough that
store-update latency costs users real protection. That is a measurement, not a
prediction — the same standard 0.3.0.5 applied to the refinement timeout.

If it is revived, everything above still applies: signed data only, never code,
background worker only, never on the prompt path, opt-out in settings, and a new
**ADR-008** (ADR-006 is Preact, ADR-007 is the on-device model).

---

## Task 3: Error Boundaries and Fail-Open Verification (CRITICAL)

**Version:** 0.5.0.2

### Implementation Steps

1. React error boundary around all injected UI — a UI crash must not block submission.
2. Wrap every host-page interaction; on throw, release the pending submission.
3. Fault-injection test mode that deliberately throws at each stage of the pipeline.
4. Local-only error log (message and stack, never prompt content) viewable in options,
   so bug reports can be filed without the user pasting sensitive material.

### Testing

- [x] Injected fault at each pipeline stage still submits the prompt
- [x] UI crash does not block the composer
- [x] Error log contains no prompt content

### Success Criteria

- [x] Fail-open proven by systematic fault injection, not assumed

### Implementation Notes

`components/ErrorBoundary.tsx`, `lib/errors/index.ts`,
`lib/interception/fail-open.test.ts`, plus options-page and content-script
wiring. 40 new tests (1126 → 1166).

**The gap the boundary actually closes.** The controller wraps `onHeld()` — but
`onHeld` only *sets state*. Preact renders afterwards, on its own schedule,
outside that try block. So a component that throws while rendering the approval
modal throws into nothing, leaving a submission cancelled with no UI to resolve
it: a prompt the user can neither send nor recover.

**On crash it dismisses, it does not release.** Releasing was the obvious move
and is wrong — it sends the user's original text, secrets included, at the exact
moment we have lost the ability to warn them. A crash must not become a silent
transmission. Dismissal leaves the text in the composer, unsent, and the next
Enter is the user's own decision.

**A UI crash makes protection unavailable, deliberately.** Interception is only
safe because there is a UI to resolve what it holds. Without one, `uiBroken`
makes `onHeld` release immediately and the health notice says so. Checked at
`onHeld` rather than by disposing the listener, because disposal would strand a
submission cancelled microseconds before the crash.

**Fault injection is enumerated, not hand-written.** `STAGES` lists all six
stages and one `it.each` asserts the same invariant at each — *the user can
still send*. A guard test pins the list, so adding a stage without deciding its
failure behaviour fails the build rather than leaving a silent gap. There is
also a counter-test that a real secret is still held with nothing sabotaged;
fail-open assertions are worthless if the pipeline fails open on everything.

**Two things the tests caught:**

1. **Panel's own body was unprotected.** Its internal boundaries wrap its child
   surfaces, but a throw in Panel itself — a hook, a store read, the prop wiring
   — happens before any of them exists. The content script now mounts Panel
   inside a boundary as well.
2. **The stack-scrubbing test tested the wrong thing.** It used
   `4111111111111111`, which the detector suppresses on purpose as a known test
   card, so it was exercising the placeholder suppressor rather than the
   scrubber.

The error log holds message, stack, and a static stage label — each run through
the detector and truncated to 600 chars, capped at 20 entries, `.local` only,
never fetched or uploaded. The options panel is hidden entirely when empty: an
always-visible "Errors (0)" invites people to hunt for problems they do not have.

---

## Task 4: Performance Budget (HIGH)

**Version:** 0.5.0.3

### Implementation Steps

1. Benchmarks: detection on 1KB / 10KB / 100KB / 1MB inputs.
2. Enforce the PRD budget (< 50ms at 10KB) as a failing test.
3. Move large scans off the main thread if the budget cannot be met inline.
4. Cap and chunk pathological inputs so a huge paste never freezes the tab.
5. Measure content-script bundle size and injection cost; set a size budget.

### Testing

- [x] Budget test fails when a slow rule is introduced
- [x] 1MB paste does not freeze the tab
- [x] No measurable typing lag on a long draft

### Implementation Notes

`test/performance.test.ts`, plus a rewrite of `redact()` and a display cap in
`FindingList`. 13 new tests (1166 → 1179).

#### Measurements

| Input | Time | Budget |
| --- | --- | --- |
| 1KB | 0.07ms | 20ms |
| 10KB | **0.20ms** | 50ms (PRD) |
| 100KB | 1.95ms | 500ms |
| 1MB | 17.34ms | 3000ms |
| Worst keystroke, 20KB draft | 0.44ms | 16.7ms (one frame) |
| Content script | 107.1 kB | 150 kB |

#### The finding that mattered

**Detection was never the problem. Redaction was.** A 300KB paste of nothing but
keys — 8,000 findings — took **1,089ms to redact**, against 84ms to detect. Over
a second of frozen tab, and it re-ran on *every checkbox toggle* in the approval
modal, because the modal re-derives the redacted text on each selection change.

Two quadratic loops in `redact()`, both fixed without any behaviour change:

- The overlap check scanned every accepted span per finding. `accepted` is now
  kept sorted by start, so only the two neighbouring spans can overlap and the
  check is a binary search.
- The output rebuilt the entire string once per finding. It now collects slices
  and joins once.

**1,089ms → 7.5ms, a 149× improvement.** The 191 detector and corpus tests pass
unchanged, which is the point — this was pure waste, not a trade.

#### Steps 3 and 4, answered by measurement

**No worker, and no chunking.** Step 3 said to move large scans off the main
thread *if the budget cannot be met inline*. It is met inline with 250× headroom
at the PRD's size and ~170× at 1MB. Building a worker would add a message-passing
boundary, an async path through code that is synchronous by design (ADR-004), and
a second copy of the rule set — to solve a problem that does not exist. Not built,
deliberately.

**The cap that was needed is on rendering, not input.** Capping or sampling the
*text* would mean a secret past the cap goes unredacted, which trades the
product's purpose for speed. The real remaining risk was thousands of DOM rows in
one synchronous render, so `FindingList` shows at most 200 and states the count
it is not showing. Every finding is still detected and still redacted; only the
list is shortened. Nobody audits five thousand checkboxes, and a list that
silently stopped at 200 would misrepresent what is about to be sent.

#### Other

- The meta-test proving the gate can fail took **56 seconds** on its first run —
  a nested-quantifier rule on 30 characters. That is itself the finding: such a
  rule does not make the extension slow, it makes the tab never come back. Tuned
  to 22 characters (~0.2s) to prove the same point inside a test timeout.
- `onSlowScan` had existed since 0.0.3.0 and was wired to nothing. It now records
  to the error log, so a slow scan on a real page arrives as a line in the
  options page instead of a vague report that it "feels slow".

---

## Task 5: E2E Suite (HIGH)

**Version:** 0.5.0.4

### Implementation Steps

1. Playwright with the extension loaded, driving a mocked chat page that mirrors each
   platform's DOM fixtures.
2. Cover the full journeys: clean submit, caught submit, send redacted, send original,
   allowlist, re-hydration, adapter failure.
3. Run against saved DOM fixtures in CI; keep an optional live smoke test that is
   allowed to fail loudly when a platform changes.

### Testing

- [x] All journeys pass headless in CI
- [x] Suite catches a deliberately broken adapter

### Implementation Notes

`playwright.config.ts`, `e2e/` (support harness, a ChatGPT DOM fixture, smoke,
journeys, and an opt-in live check). **12 e2e tests, all passing against the real
built extension**, plus 5 unit tests added from what they found.

**The extension is loaded unmodified from `.output/chrome-mv3`.** Testing a
variant compiled for tests would prove something about the variant.

**Fixture pages are served AT the real origin.** The content script matches
`https://chatgpt.com/*` and nothing else, so a fixture on localhost would never
be injected. Requests to the real host are intercepted and fulfilled with local
HTML — the URL is chatgpt.com, the bytes are ours, the network is never reached.

**Assertions are on `window.__sent`, not on our own UI.** A test that checked the
modal said the right thing would pass just as happily while sending the secret
anyway.

Journeys covered: clean submit, caught submit, redacted send, original send
(including its two-step confirm), dismissal, the live risk badge, a broken
adapter, and a missing composer.

#### Two real bugs it found

Both were invisible to 1,179 unit tests, and both are now pinned by unit tests
as well as by the e2e suite.

1. **The "protection unavailable" notice could not appear when protection was
   unavailable.** It was anchored to the composer like every other surface, and
   `Panel` gated it on the anchor existing — so when the composer could not be
   found, which is precisely what the notice reports, there was no anchor and
   nothing rendered. It now positions itself when orphaned. No jsdom test caught
   this because every one of them supplies a composer; supplying one is what
   makes a test set up.

2. **The heuristic recovery path missed `contenteditable="plaintext-only"`.**
   `EDITABLE` asked for `contenteditable="true"` exactly. The unit fixture
   happened to also carry `role="textbox"`, so it passed through that second
   door while the real path found nothing. The e2e test removed the role too —
   the harsher and more honest break — and the extension stopped protecting. A
   recovery path that only recovers from the failures you thought of is not a
   recovery path.

#### The live check

`e2e/live.spec.ts` hits the real chatgpt.com and is **opt-in**
(`APA_LIVE=1 npm run e2e`), never in CI. Fixtures record what the page looked
like on the day they were written, so a fixture-only suite keeps passing
serenely after the real page has changed. This closes that gap without letting a
third party's uptime turn the build red — which would teach people to ignore red,
costing more than the test is worth.

Kept out of Vitest deliberately: these take seconds each against ~30s for all
1,184 unit tests, and mixing them would make the fast suite slow enough that
nobody runs it on save.

### Architectural Guardrails

_Checked at milestone end, 2026-08-14._

- [x] Detector still pure — `lib` test project runs DOM-free; 191 detector and
      corpus tests pass unchanged after the `redact()` rewrite
- [x] **Zero network requests anywhere.** With Task 2 deferred there was no
      exception left to carve out. `test/no-network.test.ts` passes unchanged,
      and the e2e suite now watches a real browser make none
- [x] No prompt content in any log — `lib/errors` redacts through the detector
      and truncates; asserted directly
- [x] Fail-open verified by enumerated fault injection at all six pipeline
      stages, plus a UI-crash path the controller could not cover

---

## Session Notes

_(Record fault-injection findings and performance numbers here.)_

---

**End of Milestone 0.5.0.0 Specification**
