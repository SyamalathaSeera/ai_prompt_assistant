# Milestone 0.0.3.0 - Site Adapter Layer and Interception

**Version:** 0.0.3.0
**Date Created:** 2026-08-12
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** ARCHITECTURE.md pattern 3

Connect the detector to a real page. Build the ChatGPT adapter and the interception
layer that catches submit and paste before anything leaves the browser.

---

## Version Information

**Current Version (at milestone start):** `0.0.2.6`
**Target Version:** `0.0.3.5`
**Git Branch:** `syamalatha-MMDDYY-0.0.3.0-ext`

---

## Progress Summary

**Completion:** 0 of 6 tasks complete (0%)

| Task                                   | Priority | Status  | Version | Verified |
| -------------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization       | SETUP    | Pending | 0.0.3.0 | -        |
| Task 1: SiteAdapter interface + registry| HIGH    | Pending | 0.0.3.1 | -        |
| Task 2: ChatGPT adapter                | CRITICAL | Pending | 0.0.3.2 | -        |
| Task 3: Submit interception            | CRITICAL | Pending | 0.0.3.3 | -        |
| Task 4: Paste interception             | HIGH     | Pending | 0.0.3.4 | -        |
| Task 5: Live-scan pipeline + debounce  | MEDIUM   | Pending | 0.0.3.5 | -        |

---

## Overview

**Objective:** Reliably read the ChatGPT composer, detect on its content, and hold
submission when high-tier findings exist — without ever breaking the chat.

**Estimated Effort:** 3–5 hours

**Dependencies:** 0.0.2.0 (a working detector)

**Primary risk:** host DOM churn. Mitigation is the adapter boundary plus documented
fallback chains, not clever selectors.

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch `syamalatha-MMDDYY-0.0.3.0-ext`, Date Started.

---

## Task 1: SiteAdapter Interface and Registry (HIGH)

**Version:** 0.0.3.1

### Implementation Steps

1. Implement `SiteAdapter` exactly as defined in ARCHITECTURE.md.
2. `registry.ts`: resolve `location.hostname` to an adapter; return `null` for unknown
   hosts and exit quietly.
3. Every adapter method returns a nullable/safe result. A missing composer is a normal
   condition (the page may still be loading), not an error.
4. Add an adapter self-check that reports which selectors resolved — this becomes the
   diagnostic surface when ChatGPT ships a DOM change.

### Testing

- [ ] Unknown host → no-op, no console noise
- [ ] Registry unit-tested with fake hostnames

---

## Task 2: ChatGPT Adapter (CRITICAL)

**Version:** 0.0.3.2

### Description

The only file in the project allowed to know what ChatGPT's DOM looks like.

### Implementation Steps

1. `getComposer()` with a documented fallback chain: prefer role/aria attributes and
   `contenteditable`/`textarea` semantics; treat generated class names as a last resort.
2. `getText()` / `setText()` — ChatGPT's composer is a rich editor, so setting text must
   dispatch the events the editor listens for, or React state will not update. Verify
   the value actually persists after a re-render.
3. `onSubmitIntent()` — cover Enter (without Shift), the send button click, and
   `form` submit. Return a disposer.
4. `getMessages()` — read prior turns (used later by re-hydration in 0.0.5.0).
5. `MutationObserver` to re-resolve the composer across SPA navigation, scoped narrowly
   and disconnected on teardown.

### Testing

- [ ] Composer resolves on a fresh chat, an existing chat, and after SPA navigation
- [ ] `setText()` survives a React re-render
- [ ] Disposers actually detach listeners (no leaks across navigations)
- [ ] With the adapter forced to return `null`, the chat works completely normally

### Success Criteria

- Adapter failure degrades to "extension does nothing", never to a broken chat

---

## Task 3: Submit Interception (CRITICAL)

**Version:** 0.0.3.3

### Description

The moment that matters. Hold the submission, run detection, and route to the approval
UI (stubbed here, built in 0.0.4.0).

### Implementation Steps

1. Capture-phase listeners so we run before the host handler.
2. On intent: read text, run `detect()`. No high-tier findings → let it through
   untouched, zero added latency.
3. High-tier findings → `preventDefault()` + `stopPropagation()`, stash the pending
   submission, and emit an event for the UI layer.
4. Wrap the entire path in try/catch. **Any** exception releases the original submission.
   Trapping a user's prompt because of our bug is the worst possible failure.
5. Add a kill switch (settings flag) that disables interception without uninstalling.

### Testing

- [ ] Clean prompt submits with no perceptible delay
- [ ] Prompt with a synthetic AWS key is held
- [ ] Throwing an exception inside the handler still submits the prompt
- [ ] Shift+Enter still inserts a newline
- [ ] IME composition (e.g. Japanese input) is not broken by the Enter handler

### Success Criteria

- Fail-open verified by deliberate fault injection

---

## Task 4: Paste Interception (HIGH)

**Version:** 0.0.3.4

### Description

The real risk moment. Someone pastes a `.env` or a stack trace. Catching at paste is far
better UX than catching at submit, because the user still has the mental context.

### Implementation Steps

1. Listen for `paste` on the composer, read `clipboardData` text.
2. Run detection on the pasted chunk alone (cheaper and more precise than rescanning).
3. High-tier findings → surface immediately rather than waiting for submit.
4. Large pastes: guard with a size cap and scan asynchronously above it, so a 5MB paste
   never freezes the tab.

### Testing

- [ ] Pasting a synthetic `.env` triggers detection at paste time
- [ ] Very large paste does not block the UI thread
- [ ] Paste of clean text is unaffected

---

## Task 5: Live-Scan Pipeline and Debounce (MEDIUM)

**Version:** 0.0.3.5

### Description

Feeds the always-on risk badge built in 0.0.4.0.

### Implementation Steps

1. Debounced `input` listener (~250ms trailing).
2. Skip rescanning unchanged text; cache the last scanned hash.
3. Emit a risk level (`none` / `low` / `high`) on the content-script event bus.
4. Enforce a hard budget: if a scan exceeds ~50ms, log a timing warning (no values).

### Testing

- [ ] No perceptible typing lag on a long draft
- [ ] Risk level updates as the draft changes
- [ ] Scan timing stays within budget on a 10KB draft

### Architectural Guardrails

- [ ] No `fetch()` added
- [ ] Adapter is the only module touching host DOM
- [ ] No detected values logged
- [ ] Fail-open verified

---

## Session Notes

_(Record ChatGPT DOM findings and selector fallbacks here — this is the section most
likely to be needed in six months.)_

---

**End of Milestone 0.0.3.0 Specification**
