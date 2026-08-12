# Milestone 0.0.5.0 - Vault and Response Re-hydration

**Version:** 0.0.5.0
**Date Created:** 2026-08-12
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** ARCHITECTURE.md ADR-005, PRD "Redaction & Re-hydration"

The differentiating feature. Swap real values back into the model's rendered response so
redaction costs the user nothing.

---

## Version Information

**Current Version (at milestone start):** `0.0.4.5`
**Target Version:** `0.0.5.4`
**Git Branch:** `syamalatha-MMDDYY-0.0.5.0-ext`

---

## Progress Summary

**Completion:** 0 of 5 tasks complete (0%)

| Task                                | Priority | Status  | Version | Verified |
| ----------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization    | SETUP    | Pending | 0.0.5.0 | -        |
| Task 1: Session vault               | CRITICAL | Pending | 0.0.5.1 | -        |
| Task 2: Response observation        | HIGH     | Pending | 0.0.5.2 | -        |
| Task 3: Re-hydration rendering      | CRITICAL | Pending | 0.0.5.3 | -        |
| Task 4: Lifecycle, expiry, purge    | HIGH     | Pending | 0.0.5.4 | -        |

---

## Overview

**Objective:** When the model echoes `[REDACTED_AWS_KEY_1]`, the user sees their real
key — locally, visually, without the value ever having been transmitted.

**Estimated Effort:** 3–4 hours

**Dependencies:** 0.0.4.0

**Security posture:** this milestone deliberately creates a place where real secrets
live in memory. Every design choice below exists to keep that window as small and as
non-persistent as possible.

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch `syamalatha-MMDDYY-0.0.5.0-ext`, Date Started.

---

## Task 1: Session Vault (CRITICAL)

**Version:** 0.0.5.1

### Implementation Steps

1. Back the vault with `chrome.storage.session` — memory-backed, cleared on browser
   restart, never synced. Confirm it is not exposed to content scripts of other
   extensions and set an appropriate access level.
2. API: `put(placeholder, value, conversationId)`, `resolve(placeholder)`, `purge(scope)`.
3. Scope entries per conversation so placeholders never bleed between chats.
4. Hard cap on entries with LRU eviction — the vault must not grow unbounded.
5. Never write vault contents to `.local` or `.sync`. Add a test that asserts this.

### Testing

- [ ] Entries survive a page reload within the same browser session
- [ ] Entries are gone after a browser restart
- [ ] Nothing appears in `chrome.storage.local` or `.sync` (asserted in test)
- [ ] LRU eviction works at the cap

### Success Criteria

- ADR-005 holds mechanically, not by convention

---

## Task 2: Response Observation (HIGH)

**Version:** 0.0.5.2

### Implementation Steps

1. Extend the ChatGPT adapter with `observeResponse()`.
2. Handle streaming: tokens arrive incrementally, so a placeholder may be split across
   mutations. Buffer and only substitute on a complete placeholder match.
3. Scope the `MutationObserver` to the message container, not `document`, and throttle.
4. Disconnect cleanly on navigation.

### Testing

- [ ] Placeholder split across streaming chunks is still matched
- [ ] Observer does not degrade rendering performance on a long conversation
- [ ] No leaked observers after ten SPA navigations

---

## Task 3: Re-hydration Rendering (CRITICAL)

**Version:** 0.0.5.3

### Implementation Steps

1. Replace placeholder text nodes with a marked inline element showing the real value.
2. Style it distinctly (subtle highlight) so the user knows it is a local substitution,
   not something the model returned. This distinction is important — misrepresenting
   what the model actually said would be worse than not substituting at all.
3. Hover/click reveals the placeholder that was actually transmitted.
4. Substitute **display only**. Never modify anything the host page might send back
   upstream, and never write the real value into an input the host controls.
5. Copying a re-hydrated code block copies the real value (that is the point) — verify
   clipboard behavior explicitly.

### Testing

- [ ] Real value appears where the placeholder was
- [ ] Substitution is visually distinguishable from model output
- [ ] Copy from a re-hydrated block yields the real value
- [ ] Unknown placeholder (vault miss) renders the placeholder unchanged, no error
- [ ] Host page's own state is unmodified

### Success Criteria

- Redaction becomes invisible to the user's workflow
- No possibility of a re-hydrated value being sent back to the model

---

## Task 4: Lifecycle, Expiry, and Purge (HIGH)

**Version:** 0.0.5.4

### Implementation Steps

1. TTL per entry (default: conversation session), plus a global "Clear vault now" control
   in the popup.
2. Purge on: browser restart, explicit user action, conversation deletion, and extension
   disable.
3. Popup shows how many values are currently held — visibility builds trust.
4. Setting to disable re-hydration entirely for users who prefer nothing be retained.

### Testing

- [ ] Manual purge empties the vault immediately
- [ ] Disabling re-hydration stops all vault writes
- [ ] Vault count in the popup is accurate

### Architectural Guardrails

- [ ] No `fetch()` added
- [ ] Vault never touches `.local` or `.sync`
- [ ] No secret value logged, even in dev builds
- [ ] Re-hydrated values are display-only and cannot be transmitted

---

## Session Notes

_(Record streaming/observer behavior findings here.)_

---

**End of Milestone 0.0.5.0 Specification**
