# Milestone 0.1.0.0 - Multi-Platform Adapters

**Version:** 0.1.0.0
**Date Created:** 2026-08-12
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** PRD out-of-MVP reach, ARCHITECTURE.md pattern 3

Prove the adapter abstraction by adding Claude and Gemini. MINOR bumps because this is a
phase change — the product stops being a ChatGPT tool and becomes a platform-agnostic one.

---

## Version Information

**Current Version (at milestone start):** `0.0.6.4`
**Target Version:** `0.1.0.4`
**Git Branch:** `syamalatha-MMDDYY-0.1.0.0-ext`

---

## Progress Summary

**Completion:** 0 of 5 tasks complete (0%)

| Task                                 | Priority | Status  | Version | Verified |
| ------------------------------------ | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization     | SETUP    | Pending | 0.1.0.0 | -        |
| Task 1: Adapter conformance suite    | HIGH     | Pending | 0.1.0.1 | -        |
| Task 2: Claude adapter               | HIGH     | Pending | 0.1.0.2 | -        |
| Task 3: Gemini adapter               | MEDIUM   | Pending | 0.1.0.3 | -        |
| Task 4: Optional permission flow     | HIGH     | Pending | 0.1.0.4 | -        |

---

## Overview

**Objective:** Adding a platform is an afternoon of work touching exactly one file plus
one manifest entry. If it is not, the abstraction failed and this milestone should fix it
rather than paper over it.

**Estimated Effort:** 4–6 hours

**Dependencies:** 0.0.6.0

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch `syamalatha-MMDDYY-0.1.0.0-ext`, Date Started.

---

## Task 1: Adapter Conformance Suite (HIGH)

**Version:** 0.1.0.1

### Description

Before writing new adapters, write the tests every adapter must pass. This is what keeps
platform three from being harder than platform two.

### Implementation Steps

1. A shared conformance test that any `SiteAdapter` implementation is run against, using
   a fixture DOM per platform.
2. Cover: composer resolution, text round-trip, submit intent firing, disposer cleanup,
   and graceful `null` when the composer is absent.
3. Capture real DOM snapshots per platform as fixtures so breakage is detectable in CI
   without a live browser.
4. Refactor the ChatGPT adapter until it passes the suite unchanged.

### Testing

- [ ] ChatGPT adapter passes conformance
- [ ] A deliberately broken adapter fails conformance

---

## Task 2: Claude Adapter (HIGH)

**Version:** 0.1.0.2

### Implementation Steps

1. Implement against `claude.ai`, following the ChatGPT adapter's fallback-chain pattern.
2. Handle its editor's event requirements for programmatic text setting.
3. Handle Projects/artifacts surfaces — confirm the composer resolves in each context.
4. Add DOM fixtures to the conformance suite.

### Testing

- [ ] Passes the conformance suite
- [ ] Detection, interception, modal, and re-hydration all work on claude.ai
- [ ] Adapter failure leaves Claude fully usable

---

## Task 3: Gemini Adapter (MEDIUM)

**Version:** 0.1.0.3

### Implementation Steps

1. Implement against `gemini.google.com`.
2. Expect heavier framework-managed DOM; lean hard on semantic selectors.
3. Add fixtures; document any capability the adapter cannot support (e.g. if response
   observation proves impractical, declare it unsupported rather than shipping a flaky
   version).

### Testing

- [ ] Passes conformance, or documents explicitly which optional methods are unsupported
- [ ] Unsupported capabilities degrade cleanly in the UI

---

## Task 4: Optional Permission Flow (HIGH)

**Version:** 0.1.0.4

### Description

Reach must not cost install conversion. ChatGPT stays the only install-time host.

### Implementation Steps

1. Enabling a platform in options calls `chrome.permissions.request()` from a user
   gesture, then registers the content script dynamically.
2. Revoking removes the script registration and the permission.
3. Handle denial gracefully with an explanation of what the permission is for.
4. Verify the install-time permission warning still names one site only.

### Testing

- [ ] Fresh install prompts for ChatGPT only
- [ ] Enabling Claude prompts separately and works immediately without a browser restart
- [ ] Revoking stops injection on that host
- [ ] Denial path is clear and non-broken

### Architectural Guardrails

- [ ] No `fetch()` added
- [ ] Detector untouched by platform additions (proof the boundary holds)
- [ ] Install-time permissions unchanged from 0.0.1.0

---

## Session Notes

_(Record per-platform DOM quirks here.)_

---

**End of Milestone 0.1.0.0 Specification**
