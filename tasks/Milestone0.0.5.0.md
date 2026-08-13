# Milestone 0.0.5.0 - Vault and Response Re-hydration

**Version:** 0.0.5.0
**Date Created:** 2026-08-12
**Date Started:** 2026-08-13
**Date Completed:** 2026-08-13
**Status:** Complete
**Based on:** ARCHITECTURE.md ADR-005, PRD "Redaction & Re-hydration"

The differentiating feature. Swap real values back into the model's rendered response so
redaction costs the user nothing.

---

## Version Information

**Current Version (at milestone start):** `0.0.4.5` (confirmed from package.json, 2026-08-13)
**Target Version:** `0.0.5.4`
**Git Branch:** `syamalatha-081326-0.0.5.0-ext` (created from `main` @ `de69128`)

---

## Progress Summary

**Completion:** 5 of 5 tasks complete (100%)

---

## Architectural Guardrails

- [x] No `fetch()` added — repo-wide ESLint rule still passing
- [x] Vault never touches `.local` or `.sync` — asserted directly in three tests
- [x] No secret value logged, and the popup displays counts only
- [x] Re-hydrated values are display-only; form controls and editable regions
      are excluded, so nothing restored can travel back upstream

| Task                                | Priority | Status  | Version | Verified |
| ----------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization    | SETUP    | Complete | 0.0.5.0 | branch ✓ |
| Task 1: Session vault               | CRITICAL | Complete | 0.0.5.1 | 481 tests ✓ |
| Task 2: Response observation        | HIGH     | Complete | 0.0.5.2 | 495 tests ✓ |
| Task 3: Re-hydration rendering      | CRITICAL | Complete | 0.0.5.3 | 520 tests ✓ |
| Task 4: Lifecycle, expiry, purge    | HIGH     | Complete | 0.0.5.4 | 533 tests ✓ |

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

**Status:** Complete (2026-08-13)

- Version at start confirmed `0.0.4.5`; milestone opens at `0.0.5.0`
- Milestone 0.0.4.0 merged to `main` via PR #4 (`de69128`)
- Branch `syamalatha-081326-0.0.5.0-ext` created from `main`
- Push deferred to milestone end, per the agreed cadence

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

- [x] Values round-trip through `storage.session`
- [x] Clearing session storage — what a browser restart does — loses everything
- [x] **Nothing** appears in `storage.local` or `.sync`, asserted directly
- [x] LRU eviction works at the cap, by recency rather than age
- [x] `npm run typecheck` and `npm run lint` pass (exit 0)

### Success Criteria

- [x] ADR-005 holds mechanically, not by convention

### Outcome (2026-08-13)

**481 tests** (was 460); 21 of them for the vault.

**ADR-005 is asserted, not asserted-to.** Three separate tests read
`storage.local` and `storage.sync` after a write and confirm both are empty *and* that
neither contains the secret string. A comment saying "we only use session storage" would
survive a refactor that broke it; these tests would not.

**Entries are keyed by conversation, not by placeholder alone.** Placeholders are
numbered per prompt, so `[REDACTED_AWS_KEY_1]` means different things in two chats.
Resolving on the placeholder alone would show one conversation's key inside another — a
leak created by the very feature meant to prevent leaks. `resolve()` therefore takes the
conversation id, a deliberate change from the stub signature in the original plan.

**Eviction is by recency, not age.** A long conversation keeps re-using the same few
placeholders, so evicting the oldest entries would discard exactly the values still being
displayed on screen. Tested by touching the oldest entry and confirming it survives a
cap overflow.

**Storage access level is granted from the background worker.** `storage.session`
defaults to trusted contexts only, which excludes content scripts — and the content
script is the only place re-hydration happens, so the vault would otherwise be
unreachable by the code that needs it.

Routing through the background worker via message-passing was considered and rejected:
re-hydration has to render plaintext in the page regardless, so the extra hop would move
no secret out of the content script's reach. Content scripts run in an isolated world, so
page JavaScript and other extensions still cannot see `chrome.storage` at all — the
boundary that actually matters is unchanged.

**Every failure path degrades to "no re-hydration", never to a broken page.** Storage
unavailable, a rejected write, a corrupted stored value — each is tested and each
resolves to a null lookup, which renders the placeholder unchanged. That is exactly what
was sent to the model, so the page stays truthful.

**`list()` returns metadata without values**, so the popup in 0.0.6.0 can show what is
held and offer to clear it without becoming another surface that displays secrets.

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

- [x] Streamed text — which mutates existing nodes — is observed
- [x] A newly appended assistant turn is reported
- [x] User turns are ignored; a turn is reported once per batch
- [x] Observer detaches on dispose; a throwing callback does not break rendering
- [x] `npm run typecheck` and `npm run lint` pass; three consecutive clean runs

### Outcome (2026-08-13)

**495 tests** (was 481). Selectors verified against a live conversation rather than
guessed — the blocker recorded at the end of milestone 0.0.3.0 is now cleared.

**Verified conversation DOM (2026-08-13):**

| Aspect | Handle |
|---|---|
| Turn element | `[data-testid^="conversation-turn-"]` |
| Role | `data-turn="user"` \| `"assistant"` on the turn |
| Stable id | `data-turn-id` |
| Inner marker | `div[data-message-author-role]`, `data-message-id` |
| Assistant body | `.markdown` |
| Conversation id | URL path `/c/<uuid>` |

**Two structural facts shaped the implementation.** Turns do **not** share a direct
parent — each sits in its own `data-turn-id-container` — and their common ancestor is an
unattributed div six levels below `main`. There is nothing stable to anchor an observer
to, so `main` is used instead: a superset, but a semantic element that will still exist
after the next redesign.

**`characterData` is required, not defensive.** Streamed tokens mutate existing text
nodes rather than appending elements, so without it a placeholder arriving mid-stream
would never be seen at all.

**A bug found by the test for the case that matters most.** When a new turn is appended,
the mutation record's `target` is the *parent* and the turn is a **descendant** of the
added node — so walking up with `closest()` sailed straight past it. Fresh assistant
replies, precisely what re-hydration exists for, were never reported. The observer now
also scans `addedNodes` and their subtrees.

**Only assistant turns are reported.** The user's own text is already theirs, and
rewriting it would change what they can see they sent.

**`getConversationId()` returns null for a fresh unsent chat** rather than inventing an
id. A synthesised id would let two different new conversations share vault entries, which
is the cross-conversation bleed the vault's scoping exists to prevent.

**Privacy note on the inspection itself:** the live conversation was examined for
structure only — element shapes, attribute names, and selector durability. No message
content was read or logged.

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

- [x] Real value appears where the placeholder was, surrounding text intact
- [x] Substitution is marked and visually distinguishable from model output
- [x] Selecting and copying a re-hydrated code block yields the real value
- [x] Vault miss renders the placeholder unchanged, no error
- [x] Form controls and editable regions are never modified
- [x] `npm run typecheck`, `npm run lint`, `npm run build` pass; three clean runs

### Success Criteria

- [x] Redaction becomes invisible to the user's workflow
- [x] No path by which a re-hydrated value can be sent back to the model

### Outcome (2026-08-13)

**520 tests** (was 495). Redaction is now lossless end to end: a secret is replaced on
the way out and restored on the way back, and the value never leaves the machine.

**A real bug caught by the display-only test.** The first implementation walked *every*
text node, including the inside of a `<textarea>` — whose inner text IS its value. A
restored secret written there would be read straight back by the host page and sent to
the model, undoing the entire redaction. Hydration now refuses to enter form controls,
`[contenteditable]` (which is the composer itself), `script`, and `style`.

**The substitution is deliberately visible.** A dashed underline and a hover title
naming the placeholder that was actually transmitted. Silently rewriting a model's output
would be a worse dishonesty than the inconvenience it solves — the user must be able to
tell what the model said from what we restored.

**Styled with inline properties, not a stylesheet.** These spans live in ChatGPT's
document, outside our shadow root, so a stylesheet would mean injecting CSS into the page
we promised never to touch. The underline uses `currentColor`, so it adapts to the host's
theme without us having to know it. A test asserts no stylesheet is added.

**Idempotence replaces loop-suppression.** Hydration skips anything already inside a
hydrated span, so a second pass finds nothing and does nothing. Since hydration is driven
by a MutationObserver and itself mutates the DOM, that property is what stops the two
from feeding each other — no flags, no suppression windows, no timing assumptions.

**A vault miss is not an error.** The placeholder stays exactly as it is, which is
precisely what the model received, so the page remains a truthful record of the
conversation.

**Mappings are re-derived from the text actually being sent**, not taken from the UI's
copy. The user can edit the redacted prompt by hand before sending, and only placeholders
that survive into the final text are stored.

**Known limitation, for a later milestone:** ChatGPT's own "copy" button on code blocks
reads from its React state rather than the DOM, so it copies the *placeholder*. Selecting
text by hand copies the restored value correctly, and that path is tested. Intercepting
the copy button belongs with the hardening work in 0.2.0.0.

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

- [x] Manual purge empties the vault immediately, in storage as well as on screen
- [x] Disabling re-hydration stops vault writes and response observation
- [x] Vault count in the popup is accurate, and never displays a value
- [x] Expired entries are filtered on read, not merely swept on write
- [x] `npm run typecheck`, `npm run lint`, `npm run build` pass; three clean runs

### Outcome (2026-08-13)

**533 tests** (was 520).

**Expiry is sliding, measured from last access.** A conversation someone is actively
working in keeps re-resolving the same placeholders and stays hydrated; one they walked
away from expires. A fixed lifetime would break re-hydration mid-task, which is exactly
when it is most useful. Four hours: short enough that an unattended machine is not
holding secrets all day, long enough to cover a working session.

**Expired entries are filtered on every read, not only swept on write.** Expiry is a
promise about what is retained, so a value must never be returned past its lifetime even
if nothing has happened to tidy it up.

**The popup answers "what do you have of mine?" without becoming a leak itself.** It
shows a count, explains when values disappear on their own, and offers an immediate
clear — but never displays a stored value. A test asserts the secret string appears
nowhere in the rendered popup.

**Purge coverage:**

| Trigger | Mechanism |
|---|---|
| Browser restart | `storage.session` is memory-backed — automatic |
| Extension reload or disable | Session storage is cleared with it — automatic |
| Explicit user action | "Clear now" in the popup |
| Idle timeout | Sliding four-hour TTL |
| Per-conversation | `purge(conversationId)` |

Conversation *deletion* is not detected. ChatGPT exposes no signal for it, and polling
its history would mean reading the user's conversation list — a much larger intrusion
than the problem justifies. Deleted conversations expire on the TTL like any other.

**A test failure led to a better design rather than a config workaround.** The popup
rendered `__APP_VERSION__`, a bundler-injected constant that vitest does not provide.
Two attempts to plumb `define` through the project configs failed; the right fix was to
stop depending on a build-time global for something the runtime already knows.
`browser.runtime.getManifest().version` is the version that actually shipped, so it
cannot disagree with the installed extension, and the component now renders identically
under test and in the browser.

---

## Session Notes

_(Record streaming/observer behavior findings here.)_

---

**End of Milestone 0.0.5.0 Specification**
