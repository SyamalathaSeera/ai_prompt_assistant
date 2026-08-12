# Milestone 0.0.6.0 - Settings, Allowlist, Popup and Options

**Version:** 0.0.6.0
**Date Created:** 2026-08-12
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** PRD "Control"

Give the user real control over the tool. Without an allowlist and per-rule toggles, the
first false positive becomes an uninstall.

---

## Version Information

**Current Version (at milestone start):** `0.0.5.4`
**Target Version:** `0.0.6.4`
**Git Branch:** `syamalatha-MMDDYY-0.0.6.0-ext`

---

## Progress Summary

**Completion:** 0 of 5 tasks complete (0%)

| Task                              | Priority | Status  | Version | Verified |
| --------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization  | SETUP    | Pending | 0.0.6.0 | -        |
| Task 1: Settings schema + storage | HIGH     | Pending | 0.0.6.1 | -        |
| Task 2: Popup                     | HIGH     | Pending | 0.0.6.2 | -        |
| Task 3: Options page              | HIGH     | Pending | 0.0.6.3 | -        |
| Task 4: Allowlist management UI   | HIGH     | Pending | 0.0.6.4 | -        |

---

## Overview

**Objective:** Every behavior of the extension is inspectable and adjustable, and the
catch counter gives the user a reason to keep it installed.

**Estimated Effort:** 3–4 hours

**Dependencies:** 0.0.5.0

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch `syamalatha-MMDDYY-0.0.6.0-ext`, Date Started.

---

## Task 1: Settings Schema and Storage (HIGH)

**Version:** 0.0.6.1

### Implementation Steps

1. Typed `Settings` in `lib/policy/schema.ts` with a `schemaVersion` field and a
   migration function — settings shapes always change, and users must never lose config
   on update.
2. Defaults in `defaults.ts`: high-tier on and blocking; email/phone on as suggestions;
   noisier low-tier families off; re-hydration on.
3. Typed `chrome.storage.local` wrapper with change subscriptions so the content script
   reacts without a page reload.
4. Counter: total catches, and catches by rule family. Counts only — never values.

### Testing

- [ ] Settings change propagates to an open ChatGPT tab without reload
- [ ] Migration from a v1 shape to v2 preserves user choices
- [ ] Counter increments on a real catch

---

## Task 2: Popup (HIGH)

**Version:** 0.0.6.2

### Description

Quick status and the trust surface. Opens in under 100ms or it feels broken.

### Implementation Steps

1. Show: protection on/off for this site, catches this week / all time, vault entry count.
2. Quick toggles: pause on this site, pause for 15 minutes, clear vault.
3. "Nothing leaves your device" statement with a link to the options page explaining it.
4. Link to full settings.

### Testing

- [ ] Popup opens fast and renders correctly in light and dark
- [ ] Pause actually suppresses interception on the active tab
- [ ] Counts match reality

---

## Task 3: Options Page (HIGH)

**Version:** 0.0.6.3

### Implementation Steps

1. Rule family list grouped by tier, each with a toggle and a plain-language description
   plus a masked example of what it catches.
2. Global behavior: block vs warn on high-tier; placeholder style (bracketed vs dummy);
   re-hydration on/off; paste scanning on/off.
3. Platform toggles that request `optional_host_permissions` at the moment of enabling —
   never up front.
4. A privacy section stating exactly what is stored, where, and for how long, with a
   "delete everything" button that actually clears all storage.
5. Export/import settings as JSON (no allowlist plaintext in the export).

### Testing

- [ ] Enabling Claude triggers the permission prompt and the adapter starts working
- [ ] Declining the permission leaves the toggle off and shows why
- [ ] "Delete everything" clears local, session, and counters
- [ ] Disabling a rule family stops those findings immediately

---

## Task 4: Allowlist Management UI (HIGH)

**Version:** 0.0.6.4

### Description

Retention feature. One false positive on a value the user knows is fine must be
permanently silenceable in one click.

### Implementation Steps

1. List allowlisted entries by label, rule family, and date added — showing the hash,
   never the value.
2. Remove individual entries; clear all.
3. Add from the approval modal ("never flag this value") and confirm it appears here.
4. Note in the UI that entries are stored hashed and cannot be displayed.

### Testing

- [ ] Entry added from the modal appears in the list
- [ ] Removing an entry causes the value to be detected again
- [ ] No plaintext value is stored or rendered anywhere

### Architectural Guardrails

- [ ] No `fetch()` added
- [ ] Allowlist stores hashes only
- [ ] Counters store counts only
- [ ] Optional permissions requested at point of use, not at install

---

## Session Notes

_(Record settings schema decisions and migration notes here.)_

---

**End of Milestone 0.0.6.0 Specification**
