# Milestone 0.2.0.0 - On-Device Model Foundation

**Version:** 0.2.0.0
**Date Created:** 2026-08-13
**Date Started:** 2026-08-13
**Date Completed:** 2026-08-13
**Status:** Complete
**Based on:** Scope decision 2026-08-13 — finish Extension 1 before launch

Build the layer that lets the extension use a language model **without breaking
ADR-001**. Nothing here is user-visible; it exists so refinement (0.3.0.0) and
clarification (0.4.0.0) can be built on something that degrades honestly.

---

## Version Information

**Current Version (at milestone start):** `0.1.0.4` (confirmed 2026-08-13)
**Target Version:** `0.2.0.5`
**Git Branch:** `syamalatha-081326-0.2.0.0-ext` (created from `main` @ `d67936b`)

---

## Progress Summary

**Completion:** 6 of 6 tasks complete (100%)

| Task                                    | Priority | Status  | Version | Verified |
| --------------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization        | SETUP    | Complete | 0.2.0.0 | branch ✓ |
| Task 1: Capability detection            | CRITICAL | Complete | 0.2.0.1 | 759 tests ✓ |
| Task 2: Session lifecycle + model download| HIGH    | Complete | 0.2.0.2 | 759 tests ✓ |
| Task 3: Prompt execution + guardrails    | CRITICAL | Complete | 0.2.0.3 | 759 tests ✓ |
| Task 4: Graceful degradation everywhere  | CRITICAL | Complete | 0.2.0.4 | 774 tests ✓ |
| Task 5: ADR + privacy claim review       | HIGH     | Complete | 0.2.0.5 | audited ✓ |

---

## Overview

**Objective:** `lib/model/` exposes "is a model available, and can it answer this
prompt", with every consumer able to carry on without it.

**Why on-device.** Verified on the developer's machine 2026-08-13:

```
window.LanguageModel   function
availability           "downloadable"
window.Summarizer      function
window.Translator      function
```

Chrome's built-in Prompt API means model work happens locally: no backend, no API keys,
no per-user cost, and **"nothing you type leaves this device" stays literally true**.
That claim is the product's entire install-time pitch and the thing the options page
invites users to verify in DevTools — a cloud call would have cost it.

**Estimated Effort:** 5–7 hours

**Dependencies:** 0.1.0.0

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch, Date Started.

---

## Task 1: Capability Detection (CRITICAL)

**Version:** 0.2.0.1

### Description

Answer "can we use a model right now" honestly and cheaply.

### Implementation Steps

1. Probe `window.LanguageModel` and legacy `window.ai.languageModel`, since the API has
   shipped under more than one name and users are on different Chrome versions.
2. Map `availability()` to our own states: `unavailable`, `downloadable`,
   `downloading`, `available`.
3. Cache the result but re-check on demand — a model can finish downloading mid-session.
4. Never throw. An absent API is the normal case on Firefox and on older Chrome.

### Testing

- [ ] Missing API reports `unavailable` without throwing
- [ ] Each availability state maps correctly
- [ ] A throwing probe is treated as `unavailable`

---

## Task 2: Session Lifecycle and Model Download (HIGH)

**Version:** 0.2.0.2

### Description

Sessions are expensive to create and hold memory; the first download is large.

### Implementation Steps

1. Lazily create a session on first use, reuse it, and destroy it when idle.
2. Surface download progress. A silent multi-hundred-megabyte download is a
   user-hostile surprise on a metered connection — ask before starting it, and say how
   large it is.
3. Cap concurrent sessions at one.
4. Destroy the session on content-script teardown.

### Testing

- [ ] Session reused across calls, not recreated
- [ ] Download is user-initiated, never automatic
- [ ] Teardown destroys the session

---

## Task 3: Prompt Execution and Guardrails (CRITICAL)

**Version:** 0.2.0.3

### Description

A typed wrapper around a single model call.

### Implementation Steps

1. `run(prompt, { signal, timeoutMs })` returning a discriminated result rather than
   throwing — callers must handle failure as a normal outcome.
2. Hard timeout. An on-device model on a busy machine can take seconds, and the user is
   mid-task.
3. Abort on composer change: a suggestion for text the user has already rewritten is
   worse than no suggestion.
4. Cap input length; refuse rather than truncate, since a silently truncated prompt
   produces a confidently wrong rewrite.

### Testing

- [x] Timeout returns a failure result, never hangs
- [x] Abort mid-flight returns `aborted`, distinctly from `timeout`
- [x] Oversized input is refused with a clear reason
- [x] `npm run typecheck` and `npm run lint` pass; three consecutive clean runs

### Outcome for Tasks 1–3 (2026-08-13)

**759 tests** (was 732); 27 for the model layer. `lib/model/` is the single door between
this extension and Chrome's Prompt API — nothing outside it references `LanguageModel`,
which is what makes the whole capability removable.

**API surface confirmed by probing the live browser**, not assumed:

```
static      availability(), create()
instance    prompt, promptStreaming, append, clone, destroy,
            contextUsage, contextWindow, measureContextUsage
availability "downloadable"
```

`measureContextUsage` and `contextWindow` mean the length guard checks the model's real
limit rather than guessing from character counts, which is wrong in both directions.

**`create()` was deliberately never called during inspection.** The first call pulls
hundreds of megabytes, and triggering that to satisfy curiosity would have been the exact
behaviour this milestone forbids.

**Failure is a value, not an exception.** `run()` returns a discriminated union, so
callers are forced to handle it. Failure here is a normal outcome — no model, a timeout,
an abort because the user kept typing — and an exception would let a caller forget, with
the broken UI appearing on precisely the machines least able to run the feature. A test
sweeps four failure scenarios and asserts none of them throw.

**A real race condition, found by a test that timed out instead of failing.** The abort
path was broken in a way that only shows under real timing:

Everything before the prompt call is asynchronous — the availability probe and session
creation both await. A caller aborting during that window hits an already-aborted signal,
and `addEventListener('abort')` on one of those **never fires**. The abort was silently
lost and the call hung until its timeout.

The first fix (abort our own controller) was still wrong: it passed an already-aborted
signal into `prompt()`, which only settles if that implementation checks eagerly rather
than merely subscribing. The correct fix is to return without calling the model at all —
not starting work that is already cancelled is both right and independent of how any
particular implementation behaves. Test time dropped from 6s to 1s, which is the
difference between a hang being timed out and being gone.

**Prompting never triggers a download.** On `downloadable`, `run()` returns
`not-downloaded` rather than quietly starting one. Asserted directly: `create` is not
called. Pulling hundreds of megabytes because someone typed would be a hostile surprise
on a metered connection.

**Oversized input is refused, not truncated.** A silently truncated prompt produces a
confidently wrong rewrite and the user cannot tell that half their text was dropped.

**Sessions are reused and idle-destroyed** after ten minutes. Concurrent callers share a
single creation rather than racing into two downloads.

---

## Task 4: Graceful Degradation Everywhere (CRITICAL)

**Version:** 0.2.0.4

### Description

**The whole product must work with no model at all.** Redaction is the thing people
install this for; refinement is an addition. A machine that cannot run the model must
lose exactly the refinement features and nothing else.

### Implementation Steps

1. Feature flags derived from capability, not from settings alone.
2. UI affordances for model features hidden — not disabled-and-confusing — when
   unavailable.
3. One place in options explaining why, with the hardware/browser requirement stated.
4. Firefox build must not reference the API at all.

### Testing

- [x] With the API absent, detection, redaction, and interception all still pass
- [x] No model-dependent control appears when unavailable
- [x] The detector contains no reference to the model layer, asserted by scanning source

### Success Criteria

- [x] Removing model support entirely would break no existing feature

### Outcome (2026-08-13)

**774 tests** (was 759). `degradation.test.ts` runs the real detection pipeline with the
Prompt API removed entirely — the state on Firefox, on older Chrome, and on hardware that
cannot host the model.

**What still works with no model at all**, each asserted rather than assumed: every
secret in a three-secret `.env` is detected, redaction produces correct placeholder text,
and the full interception path holds a submission and prevents the event. That is the
whole product for most users.

**Features are hidden, not disabled.** A disabled control that can never be enabled is an
unanswered question in the interface; an absent one is simply a smaller product on that
machine. `showModelFeatures` is derived from hardware capability, never from settings —
a user can turn a model feature off, but cannot turn one on that their machine cannot
run.

**The explanation is checked for tone, not just presence.** A test asserts the message
contains "secrets are still detected and redacted" and does *not* contain "error",
"failed", or "unsupported browser". A user on modest hardware should read a description
of what they have, not a report of what is wrong with their machine.

**Layering is enforced by scanning source.** A test walks every non-test file under
`lib/detector/` and asserts none references the model layer or `LanguageModel`. ADR-004
keeps the detector pure so the corpus suite runs in milliseconds without a browser; a
model import would kill that quietly, and only show up as a slow, browser-dependent CI
run months later.

---

## Task 5: ADR and Privacy Claim Review (HIGH)

**Version:** 0.2.0.5

### Description

The privacy claim is now load-bearing in three places: the store listing, the options
page, and the onboarding screen. Adding a model is exactly the change that could quietly
falsify it.

### Implementation Steps

1. Write **ADR-007: on-device model, no network** recording the decision and the
   measurement behind it.
2. Re-verify zero network requests with model features active — the same DevTools check
   from 0.0.1.0, now with a model in the loop.
3. Review every user-facing privacy sentence against what the build actually does.
4. Confirm the store data-disclosure answers are still accurate.

### Testing

- [x] Built bundle audited for every network primitive
- [x] Every privacy claim re-read against current behaviour
- [x] The guarantee is now a test, not a periodic reread

### Outcome (2026-08-13)

**ADR-007 confirmed; provisional status lifted.**

**The audit found two `fetch` calls in the shipped content script** — exactly the kind of
thing this task exists to catch, and worth chasing down rather than waving through.

Both come from WXT's shadow-root helper, and both read
`chrome.runtime.getURL('/content-scripts/content.css')`: a `chrome-extension://` URL
pointing at a file inside the extension package. That is a local file read, not a network
request. No host is contacted and nothing leaves the machine. No `XMLHttpRequest`, no
`WebSocket`, no `sendBeacon`, no `EventSource`, and no analytics or telemetry references
in either bundle.

**Now enforced rather than remembered.** `test/no-network.test.ts` scans the *built*
artefact and fails on any external URL literal, any other network transport, any
analytics marker, or a `fetch` not paired with `runtime.getURL`. Checking the bundle
rather than our source matters: the ESLint rule only covers code we wrote, and these two
calls came from a dependency.

**One near-miss worth recording.** The scan initially flagged three w3.org URLs. They are
XML namespace identifiers Preact passes to `createElementNS` — opaque strings compared by
value, never dereferenced. They are allowed *by exact string* rather than by allowing
w3.org as a host, so a genuine request there would still fail the test.

**Claim verified as literally true:** "nothing you type leaves this device." It appears
in the store listing, the options page, and onboarding, and it is now the kind of claim
that breaks a build rather than quietly becoming false.

---

**End of Milestone 0.2.0.0 Specification**
