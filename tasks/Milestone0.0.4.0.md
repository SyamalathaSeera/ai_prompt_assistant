# Milestone 0.0.4.0 - Approval Modal and Risk Badge

**Version:** 0.0.4.0
**Date Created:** 2026-08-12
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** PRD "Control", ARCHITECTURE.md pattern 4

The user-facing half of the product. Shadow-DOM isolated UI that shows what was found,
offers the redacted version, and never modifies a prompt without approval.

**Completing this milestone produces the first genuinely usable version of the product.**

---

## Version Information

**Current Version (at milestone start):** `0.0.3.5`
**Target Version:** `0.0.4.5`
**Git Branch:** `syamalatha-MMDDYY-0.0.4.0-ext`

---

## Progress Summary

**Completion:** 0 of 6 tasks complete (0%)

| Task                                  | Priority | Status  | Version | Verified |
| ------------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization      | SETUP    | Pending | 0.0.4.0 | -        |
| Task 1: Shadow DOM mount + Tailwind   | CRITICAL | Pending | 0.0.4.1 | -        |
| Task 2: Approval modal                | CRITICAL | Pending | 0.0.4.2 | -        |
| Task 3: Finding list + diff view      | HIGH     | Pending | 0.0.4.3 | -        |
| Task 4: Risk badge (always-on)        | HIGH     | Pending | 0.0.4.4 | -        |
| Task 5: Accessibility + keyboard flow | HIGH     | Pending | 0.0.4.5 | -        |

---

## Overview

**Objective:** A user can see exactly what was detected, understand why, and choose
accept / edit / send anyway — in under three seconds.

**Estimated Effort:** 4–6 hours

**Dependencies:** 0.0.3.0

**Design principle:** this UI appears at the moment someone is trying to do something
else. It must be fast to dismiss and never feel like an obstacle. Friction here is what
turns a security tool into an uninstall.

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch `syamalatha-MMDDYY-0.0.4.0-ext`, Date Started.

---

## Task 1: Shadow DOM Mount and Tailwind Isolation (CRITICAL)

**Version:** 0.0.4.1

### Implementation Steps

1. Create a host element appended to `document.body`, attach `shadowRoot` (open mode for
   debuggability), mount React inside it.
2. Inject the Tailwind bundle as a `<style>` inside the shadow root — not the page head.
3. Use WXT's content-script UI helper if it handles shadow mounting cleanly; otherwise
   mount manually.
4. Set an extreme `z-index` and verify against ChatGPT's own modals and dropdowns.
5. Respect the host page's light/dark mode via `prefers-color-scheme`.

### Testing

- [ ] Host page styles do not affect our UI
- [ ] Our styles do not leak into the host page (verify ChatGPT's layout is untouched)
- [ ] UI renders above ChatGPT's own overlays
- [ ] Dark mode matches the host

---

## Task 2: Approval Modal (CRITICAL)

**Version:** 0.0.4.2

### Description

Shown when submission is held. Three actions, no ambiguity.

### Implementation Steps

1. Actions: **Send redacted** (primary), **Edit manually**, **Send original**.
2. "Send original" requires a deliberate second interaction — not a dialog, but visibly
   secondary. It must remain genuinely available; a tool that traps prompts gets removed.
3. Show counts by type ("2 API keys, 1 connection string"), not a wall of raw values.
4. Sending resumes the *original* submission path via the adapter, so ChatGPT behaves
   exactly as if the user pressed Enter.
5. Modal state machine: `hidden → reviewing → applying → sent`, with no path that can
   strand a pending submission.

### Testing

- [ ] Send redacted → placeholder text arrives in the chat
- [ ] Send original → original text arrives unchanged
- [ ] Edit → user's edit is what gets sent
- [ ] Escape closes and releases the pending submission (never silently discards it)
- [ ] Closing the tab mid-review loses nothing beyond the draft ChatGPT itself keeps

---

## Task 3: Finding List and Diff View (HIGH)

**Version:** 0.0.4.3

### Implementation Steps

1. Per finding: label, tier badge, truncated masked preview (e.g. `AKIA…MPLE`), and the
   placeholder it becomes.
2. Per-finding toggle — redact this one, skip that one.
3. Inline diff of before/after so the user can see exactly what changes.
4. "Never flag this value" writes to the allowlist (hashed).
5. Low-tier findings render collapsed by default so they never dominate the dialog.

### Testing

- [ ] Toggling a finding updates the preview immediately
- [ ] Allowlisting suppresses that value on the next scan
- [ ] Masked previews never render the full secret

---

## Task 4: Risk Badge (HIGH)

**Version:** 0.0.4.4

### Description

The passive layer. The dropdown-style "click to check" model from the original concept
is deliberately rejected — users will not remember to invoke it.

### Implementation Steps

1. Small indicator anchored near the composer, driven by the live-scan pipeline.
2. States: neutral (nothing found), amber (low-tier), red (high-tier).
3. Click opens the review UI without submitting.
4. Must not shift the host layout or overlap the send button. Reposition on resize.

### Testing

- [ ] Badge updates as the draft changes
- [ ] Does not obstruct any ChatGPT control at common window sizes
- [ ] Survives SPA navigation

---

## Task 5: Accessibility and Keyboard Flow (HIGH)

**Version:** 0.0.4.5

### Implementation Steps

1. Focus trap in the modal; focus returns to the composer on close.
2. `role="dialog"`, `aria-modal`, labelled title and description.
3. Full keyboard operation: Tab order, Enter for primary, Escape to dismiss.
4. Verify contrast ratios in both themes.
5. Screen reader announces the finding count on open.

### Testing

- [ ] Entire flow completable without a mouse
- [ ] Focus never escapes the modal while open
- [ ] Contrast passes WCAG AA in light and dark

### Architectural Guardrails

- [ ] No `fetch()` added
- [ ] All UI inside the shadow root
- [ ] No full secret values rendered or logged
- [ ] Escape/error paths always release the pending submission

---

## Session Notes

_(Record UI decisions and any host-page layout conflicts here.)_

---

**End of Milestone 0.0.4.0 Specification**
