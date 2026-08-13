# Milestone 0.0.6.0 - Settings, Allowlist, Popup and Options

**Version:** 0.0.6.0
**Date Created:** 2026-08-12
**Date Started:** 2026-08-13
**Date Completed:** 2026-08-13
**Status:** Complete
**Based on:** PRD "Control"

Give the user real control over the tool. Without an allowlist and per-rule toggles, the
first false positive becomes an uninstall.

---

## Version Information

**Current Version (at milestone start):** `0.0.5.4` (confirmed from package.json, 2026-08-13)
**Target Version:** `0.0.6.4`
**Git Branch:** `syamalatha-081326-0.0.6.0-ext` (created from `main` @ `3e34cb5`)

---

## Progress Summary

**Completion:** 5 of 5 tasks complete (100%)

---

## Architectural Guardrails

- [x] No `fetch()` added — repo-wide ESLint rule still passing
- [x] Allowlist stores one-way hashes plus non-sensitive metadata only
- [x] Counters store counts by rule and by day — never values, never prompt text
- [x] Optional permissions requested at point of use; install-time manifest
      still asks for `storage` plus the two ChatGPT hosts and nothing else

| Task                              | Priority | Status  | Version | Verified |
| --------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization  | SETUP    | Complete | 0.0.6.0 | branch ✓ |
| Task 1: Settings schema + storage | HIGH     | Complete | 0.0.6.1 | 575 tests ✓ |
| Task 2: Popup                     | HIGH     | Complete | 0.0.6.2 | 585 tests ✓ |
| Task 3: Options page              | HIGH     | Complete | 0.0.6.3 | 603 tests ✓ |
| Task 4: Allowlist management UI   | HIGH     | Complete | 0.0.6.4 | 620 tests ✓ |

---

## Overview

**Objective:** Every behavior of the extension is inspectable and adjustable, and the
catch counter gives the user a reason to keep it installed.

**Estimated Effort:** 3–4 hours

**Dependencies:** 0.0.5.0

---

## Task 0: Milestone Initialization (SETUP)

**Status:** Complete (2026-08-13)

- Version at start confirmed `0.0.5.4`; milestone opens at `0.0.6.0`
- Milestone 0.0.5.0 merged to `main` via PR #5 (`3e34cb5`)
- Branch `syamalatha-081326-0.0.6.0-ext` created from `main`
- Push deferred to milestone end, per the agreed cadence

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

- [x] Settings change propagates without reload, and updates the sync view
- [x] Migration preserves user choices from unversioned and newer-versioned values
- [x] Counter increments per catch, by rule and by day
- [x] `npm run typecheck`, `npm run lint`, `npm run build` pass; three clean runs

### Outcome (2026-08-13)

**575 tests** (was 533). `lib/storage/index.ts` is implemented, replacing the stub that
threw since 0.0.1.0, and the content script now reads real settings.

**A synchronous settings view, because the interception path cannot await.** `detect()`
is synchronous by design (ADR-004), and making the submit handler async would mean the
prompt is already gone by the time settings arrive. Settings are loaded once into a
cache and refreshed via `storage.onChanged`, so an open ChatGPT tab picks up a change
made in the options page without a reload. `getSettingsSync()` returns defaults before
the first load completes — the safe direction, since defaults have protection enabled.

**Migration validates field by field rather than spreading over defaults.** A boolean
arriving as the string `"false"` is truthy, so a naive spread would silently invert the
user's intent — surfacing months later as "it stopped protecting me". Each field is type-
checked and falls back individually, because losing one setting is much better than
losing all of them.

**The subtle case: an explicitly empty list is not "unset".** A user who has re-enabled
every rule family stores `disabledRuleIds: []`. Treating that as missing and restoring
the defaults would silently turn their rules back off on the very next read. Tested.

**Counters gained a `byDay` histogram.** A single running total cannot answer "how many
this week", and a timestamp per catch would be an unnecessary record of when the user was
working. A daily histogram answers the question at the coarsest useful granularity, and
is trimmed to 30 days so it stays bounded. A test asserts the stored counters contain a
rule id and nothing resembling a secret.

**The allowlist is finally connected.** `lib/policy/allowlist.ts` has been implemented
and tested since 0.0.2.0 but its `onAllowlist` callback was unwired; "Never flag" in the
approval modal now persists a SHA-256 hash and suppresses that value everywhere.
Filtering runs over the *findings* after detection rather than over every candidate
during it — hashing is async and lives outside the detector, and findings are few.

**A behaviour worth noting:** when every blocking finding in a prompt has been
allowlisted, the submission is released instead of showing an empty modal. Interrupting
someone to tell them about nothing is exactly the false-alarm cost the tier system exists
to avoid.

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

- [x] Status reflects off / timed pause / site pause / active
- [x] Pause writes the setting the interception controller actually reads
- [x] Counts match what was recorded; the vault section reports and clears
- [x] `npm run typecheck`, `npm run lint`, `npm run build` pass; three clean runs

### Outcome (2026-08-13)

**585 tests** (was 575). The popup answers three questions in the order people ask them:
is it working now, has it done anything for me, and what do you have of mine.

**The middle one is the retention surface.** A passive security tool is invisible when it
works, so a user who never sees evidence concludes it does nothing and removes it. Week
and all-time counts are the answer, and a test asserts they show *how much* was caught
without ever showing *what*.

**Reading the active tab needs no new permission.** Chrome populates `tab.url` for hosts
we already hold permission for, so a ChatGPT tab is visible while everything else stays
opaque to us. Adding the `tabs` permission would have put "Read your browsing history"
on the install screen — directly against the PRD's minimum-permissions constraint, and
for a feature that does not need it. Confirmed: the built manifest still requests only
`storage` plus the two ChatGPT hosts.

**Pause is timed, not a toggle.** The honest use case is "I am about to paste something I
know is fine and I do not want to be asked three times". A pause that stays off until you
remember to undo it silently becomes permanent — an uninstall that thinks it is still
installed. Fifteen minutes, with "Resume now" for the impatient. The per-site pause
remains available and explicit.

**The expiry is compared against the clock on every check**, never cleared by a timer. A
timer would fail whenever the service worker slept through it, leaving protection off
past its window — which is the failure that matters.

**A lint error surfaced a real inconsistency.** `isPaused` was imported and then the same
logic re-derived inline, meaning the popup could have claimed protection the content
script was not providing. The status dot now uses the *same predicate* the interception
controller uses; the local breakdown only chooses wording.

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

- [x] Every rule has a toggle and a plain-language description
- [x] Declining a permission leaves the toggle off and explains why
- [x] "Delete everything" clears settings, counters, and the vault, and the UI resets
- [x] Turning a rule off persists to `disabledRuleIds`
- [x] `npm run typecheck`, `npm run lint`, `npm run build` pass; three clean runs

### Outcome (2026-08-13)

**603 tests** (was 585). Options page added at `entrypoints/options/`, opening in a full
tab rather than Chrome's cramped embedded pane — this page carries a rule list and a
privacy statement worth reading, and a small dialog makes both feel like fine print.

**Rule descriptions live on the rules themselves**, added as a `description` field to
`Rule` and populated for all 23. A lookup table in the UI would drift from what the rule
actually matches, and a settings page that misdescribes what it controls is worse than
one with no descriptions at all. A test asserts every rule has one.

**Descriptions are written for the person, not the engineer** — "Keys beginning AKIA or
ASIA that identify an AWS account", "Passwords inside database URLs such as postgres://".
The two tier groups are labelled by consequence rather than by jargon: "These hold your
message back" versus "These only suggest".

**Platform permissions are requested from inside the click handler**, never after an
await — MV3 discards the user gesture otherwise and Chrome rejects the request. Claude
and Gemini are listed but disabled, marked "Support is not built yet", because their
adapters arrive in 0.1.0.0. Listing them without pretending they work seemed better than
hiding them and having users wonder.

**The privacy section answers three questions and invites verification.** What is read,
what is stored on this device, what is sent anywhere — the last being "nothing", followed
by instructions to check it in DevTools. A tool that tells you how to verify its claim is
more credible than one that asks to be trusted.

**Permissions confirmed unchanged after all of this**: still `storage` plus the two
ChatGPT hosts at install, with Claude and Gemini in `optional_host_permissions`.

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

- [x] Entries list by rule label and date; removal and clear-all both persist
- [x] Removing an entry restores detection of that value
- [x] No plaintext value — and no hash — is rendered anywhere
- [x] The v1→v2 migration carries every hash across and is idempotent
- [x] `npm run typecheck`, `npm run lint`, `npm run build` pass; three clean runs

### Outcome (2026-08-13)

**620 tests** (was 603).

**The design problem: a list of hashes is unreadable.** Entries are stored one-way, so
the UI can recognise a value but never show it — which makes "you have 7 allowlisted
values" useless for deciding which to remove.

**A masked preview was considered and rejected.** `AKIA…TIC7` would be far more useful,
but it means eight characters of every allowlisted secret sitting on disk permanently.
That is impossible to square with a product whose entire claim is that it does not store
your secrets, and it would have to be declared in the store listing.

**What is stored instead is metadata that is not itself sensitive**: the rule label that
caught it, and the date. "AWS Access Key ID · Added 2026-08-13" is enough to act on. The
UI states plainly that values are one-way hashed and can never be shown, because the
omission would otherwise read as an oversight. A test asserts the hash never reaches the
DOM either.

**This required a schema change, which exercised the migration machinery for real.**
`allowlistHashes: string[]` became `allowlist: AllowlistEntry[]`, so `SCHEMA_VERSION`
went to 2 and the first genuine upgrade step exists. Every hash carries across — nothing
the user allowlisted stops being suppressed — while label and date are marked
"Allowlisted value" with no date, since they did not exist in v1 and inventing a
plausible-looking origin would be worse than admitting we do not know. Tested for
carry-over, preservation of unrelated settings, and idempotence.

Writing the migration function in Task 1 before anything needed migrating paid off
immediately: the step was ten lines against a mechanism already tested.

**A failing test caught the signature change correctly.** `onAllowlist` now receives the
rule label alongside the value, and the existing assertion still expected one argument.
The test was updated to assert both, since the second argument is the point.

---

## Session Notes

_(Record settings schema decisions and migration notes here.)_

---

**End of Milestone 0.0.6.0 Specification**
