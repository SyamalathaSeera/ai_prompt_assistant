# Milestone 0.3.0.0 - Onboarding and First-Run Experience

**Version:** 0.3.0.0
**Date Created:** 2026-08-12
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** PRD success criteria (week-4 retention ≥ 40%)

A passive security tool has a structural problem: when it works, nothing happens. Users
who install it and see nothing uninstall it. Onboarding exists to solve exactly that.

---

## Version Information

**Current Version (at milestone start):** `0.2.0.5`
**Target Version:** `0.3.0.4`
**Git Branch:** `syamalatha-MMDDYY-0.3.0.0-ext`

---

## Progress Summary

**Completion:** 0 of 5 tasks complete (0%)

| Task                                | Priority | Status  | Version | Verified |
| ----------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization    | SETUP    | Pending | 0.3.0.0 | -        |
| Task 1: Install → first catch demo  | CRITICAL | Pending | 0.3.0.1 | -        |
| Task 2: Trust / privacy explainer   | HIGH     | Pending | 0.3.0.2 | -        |
| Task 3: Ongoing value surfacing     | HIGH     | Pending | 0.3.0.3 | -        |
| Task 4: Uninstall feedback          | MEDIUM   | Pending | 0.3.0.4 | -        |

---

## Overview

**Objective:** Every new user sees the extension catch something within 30 seconds of
install, and understands within one screen that nothing leaves their machine.

**Estimated Effort:** 3–5 hours

**Dependencies:** 0.2.0.0

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch `syamalatha-MMDDYY-0.3.0.0-ext`, Date Started.

---

## Task 1: Install to First Catch (CRITICAL)

**Version:** 0.3.0.1

### Description

The single highest-leverage retention work in the project.

### Implementation Steps

1. `onInstalled` opens a welcome page (first install only, never on update).
2. The page contains a live, self-contained composer running the real detector — not a
   video, not a screenshot. The user types or pastes into it and watches the real
   approval modal appear.
3. Pre-filled sample containing a clearly synthetic AWS key and a connection string, with
   a one-click "try it" button.
4. Then a single call to action: open ChatGPT and confirm the badge appears.
5. Total time under 30 seconds. No account. No signup. No email capture.

### Testing

- [ ] Fresh install opens the welcome page exactly once
- [ ] Demo uses the real detector, not a mock
- [ ] Full flow completable in under 30 seconds
- [ ] Update does not re-trigger the welcome page

### Success Criteria

- The user has seen a real catch before they ever reach a real chat

---

## Task 2: Trust and Privacy Explainer (HIGH)

**Version:** 0.3.0.2

### Description

The install decision for a tool that reads everything you type is a trust decision. Make
the claim verifiable rather than asserted.

### Implementation Steps

1. One screen: what is read, what is stored, what is sent (nothing), where it lives.
2. Invite verification: "open DevTools → Network, use the extension, watch it stay
   empty." A tool that tells you how to check it is more credible than one that asks for
   trust.
3. State the single-host permission and why every other platform is opt-in.
4. Link to the source repository if it is public — a strong trust signal for this audience.
5. Plain language. No legal boilerplate on this screen; the privacy policy is separate.

### Testing

- [ ] Claims on the page exactly match actual behavior (re-verify before every release)
- [ ] The DevTools verification instruction genuinely produces an empty Network tab

---

## Task 3: Ongoing Value Surfacing (HIGH)

**Version:** 0.3.0.3

### Implementation Steps

1. Badge text on the toolbar icon reflecting recent catches.
2. Popup leads with the catch count — the answer to "why do I still have this installed."
3. A milestone moment at the first genuine catch: brief, non-intrusive acknowledgement
   with an unobtrusive path to rate the extension. Store rating is a launch-critical
   input, and the moment right after a real catch is when goodwill is highest.
4. Never nag. One rating prompt, ever, and only after a real catch.

### Testing

- [ ] Badge updates on catch
- [ ] Rating prompt appears at most once, and never before a genuine catch
- [ ] Nothing is transmitted by any of this

---

## Task 4: Uninstall Feedback (MEDIUM)

**Version:** 0.3.0.4

### Implementation Steps

1. `chrome.runtime.setUninstallURL` to a simple form.
2. One question: why did you remove it, with false-positives / did-nothing /
   broke-something / other as options.
3. Fully optional, no identifiers, no pre-filled data, nothing carried over from the
   extension.
4. This is the only honest signal about why retention is failing — false positives and
   invisibility are the two hypotheses, and it distinguishes them.

### Testing

- [ ] Uninstall opens the URL
- [ ] No user data or identifier is attached to the URL

### Architectural Guardrails

- [ ] Welcome demo uses the real detector
- [ ] No prompt content leaves the device
- [ ] Uninstall URL carries no identifiers
- [ ] Privacy claims verified against actual behavior

---

## Session Notes

_(Record onboarding copy iterations and any measured drop-off here.)_

---

**End of Milestone 0.3.0.0 Specification**
