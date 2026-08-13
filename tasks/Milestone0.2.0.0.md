# Milestone 0.2.0.0 - On-Device Model Foundation

**Version:** 0.2.0.0
**Date Created:** 2026-08-13
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** Scope decision 2026-08-13 — finish Extension 1 before launch

Build the layer that lets the extension use a language model **without breaking
ADR-001**. Nothing here is user-visible; it exists so refinement (0.3.0.0) and
clarification (0.4.0.0) can be built on something that degrades honestly.

---

## Version Information

**Current Version (at milestone start):** `0.1.0.4`
**Target Version:** `0.2.0.5`
**Git Branch:** `syamalatha-MMDDYY-0.2.0.0-ext`

---

## Progress Summary

**Completion:** 0 of 6 tasks complete (0%)

| Task                                    | Priority | Status  | Version | Verified |
| --------------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization        | SETUP    | Pending | 0.2.0.0 | -        |
| Task 1: Capability detection            | CRITICAL | Pending | 0.2.0.1 | -        |
| Task 2: Session lifecycle + model download| HIGH    | Pending | 0.2.0.2 | -        |
| Task 3: Prompt execution + guardrails    | CRITICAL | Pending | 0.2.0.3 | -        |
| Task 4: Graceful degradation everywhere  | CRITICAL | Pending | 0.2.0.4 | -        |
| Task 5: ADR + privacy claim review       | HIGH     | Pending | 0.2.0.5 | -        |

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

- [ ] Timeout returns a failure result, never hangs
- [ ] Abort mid-flight leaves no dangling session
- [ ] Oversized input is refused with a clear reason

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

- [ ] With the API stubbed out, every redaction test still passes
- [ ] No model-dependent control appears when unavailable
- [ ] Firefox build contains no Prompt API references

### Success Criteria

- Removing model support entirely would break no existing feature

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

- [ ] Zero network requests observed with refinement exercised
- [ ] Every privacy claim re-read against current behaviour

---

**End of Milestone 0.2.0.0 Specification**
