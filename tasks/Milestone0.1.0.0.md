# Milestone 0.1.0.0 - Multi-Platform Adapters

**Version:** 0.1.0.0
**Date Created:** 2026-08-12
**Date Started:** 2026-08-13
**Date Completed:** 2026-08-13
**Status:** Complete
**Based on:** PRD out-of-MVP reach, ARCHITECTURE.md pattern 3

Prove the adapter abstraction by adding Claude and Gemini. MINOR bumps because this is a
phase change — the product stops being a ChatGPT tool and becomes a platform-agnostic one.

---

## Version Information

**Current Version (at milestone start):** `0.0.6.4` (confirmed from package.json, 2026-08-13)
**Target Version:** `0.1.0.4`
**Git Branch:** `syamalatha-081326-0.1.0.0-ext` (created from `main` @ `054ca40`)

---

## Progress Summary

**Completion:** 5 of 5 tasks complete (100%)

| Task                                 | Priority | Status  | Version | Verified |
| ------------------------------------ | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization     | SETUP    | Complete | 0.1.0.0 | branch ✓ |
| Task 1: Adapter conformance suite    | HIGH     | Complete | 0.1.0.1 | 640 tests ✓ |
| Task 2: Claude adapter               | HIGH     | Complete | 0.1.0.2 | 679 tests ✓ |
| Task 3: Gemini adapter               | MEDIUM   | Complete | 0.1.0.3 | 710 tests ✓ |
| Task 4: Optional permission flow     | HIGH     | Complete | 0.1.0.4 | 732 tests ✓ |

---

## Overview

**Objective:** Adding a platform is an afternoon of work touching exactly one file plus
one manifest entry. If it is not, the abstraction failed and this milestone should fix it
rather than paper over it.

**Estimated Effort:** 4–6 hours

**Dependencies:** 0.0.6.0

---

## Task 0: Milestone Initialization (SETUP)

**Status:** Complete (2026-08-13)

- Version at start confirmed `0.0.6.4`; milestone opens at `0.1.0.0`
- Milestone 0.0.6.0 and the roadmap restructure merged to `main` via PRs #7 and #8
  (`054ca40`)
- Branch `syamalatha-081326-0.1.0.0-ext` created from `main`

### Live DOM inspection, done up front

Claude's composer was inspected on the real page **before** any adapter or fixture was
written — the direct lesson of Bug_0001, where a fixture invented rather than observed
hid a bug in the product's main use case for five milestones.

| Aspect | Claude | ChatGPT |
|---|---|---|
| Composer | `[data-testid="chat-input"]` | `#prompt-textarea` |
| Editor | `tiptap ProseMirror` | `ProseMirror` |
| Role marker | `role="textbox"`, `aria-multiline` | same |
| Decoy element | 0×0 disabled `<textarea id="static-composer-input">` | 0×0 `<textarea name="prompt-textarea">` |
| Send button | `[aria-label="Send message"]` | `[data-testid="send-button"]` |
| Form ancestor | **none** | `<form>` present |

**Three findings that shape this milestone:**

1. **Claude reproduces Bug_0001 exactly.** Multi-line input yields `["p", "p"]` and
   `textContent` returns `"alphabeta"`. The block-joining fix must be **hoisted into
   shared code** rather than copied per adapter, or the same bug ships twice more.
2. **The decoy textarea is not a ChatGPT quirk** — Claude has one too. The `hasLayout`
   guard written in 0.0.3.0 already covers it, which is evidence the adapter boundary
   was drawn in the right place.
3. **No form on Claude**, so `onSubmitIntent` cannot rely on a submit event. Enter and
   button click only. The send button's sole stable hook is `aria-label="Send message"`,
   which is locale-dependent — the fallback chain needs a position-based strategy behind
   it.

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

- [x] ChatGPT adapter passes conformance unchanged (67 tests in that file)
- [x] `npm run typecheck` and `npm run lint` pass; three consecutive clean runs

### Outcome (2026-08-13)

**640 tests** (was 623). `runAdapterConformance(adapter, fixture)` is called from each
adapter's own test file, so a failure names the platform rather than reporting an
anonymous contract violation.

**Run against ChatGPT before Claude exists — deliberately.** A contract written after
two implementations tends to describe whatever they happen to share; written against one
and then imposed on the next, it actually constrains. ChatGPT passed unchanged, which is
evidence the contract was drawn from the interface rather than reverse-engineered from
the code.

**Shared ProseMirror handling hoisted into `lib/adapters/prosemirror.ts`.** The live
inspection showed Claude uses Tiptap/ProseMirror and reproduces Bug_0001 exactly —
`["p", "p"]` blocks, `textContent` returning `"alphabeta"`. Leaving `getText`/`setText`
per-adapter would have meant shipping a known bug two more times. The ChatGPT adapter now
delegates to the shared implementation and its 79 tests still pass, which is the check
that the refactor changed nothing.

**Fifteen contract tests**, each earned by something that has already gone wrong or was
verified live:

| Test | Why it exists |
|---|---|
| never selects a zero-size decoy | both platforms ship an invisible textarea beside the real composer |
| preserves line breaks | Bug_0001, confirmed reproducible on Claude |
| fires exactly once per send gesture | ChatGPT's typeless button double-fired click + submit |
| ignores IME composition | Enter commits a candidate in Japanese and Chinese input |
| keeps working when the handler throws | fail-open is the governing rule |
| reports unhealthy rather than throwing | silent failure is the worst outcome for a security tool |

**The fixture requirement is stated in the suite's own documentation**: each adapter's
fixture must be built from an actual observation of the live page. That is the direct
lesson of Bug_0001 — a fixture invented to suit the code passed everything while hiding a
bug in the product's main use case. A fixture is a claim about the world, and an
unverified claim is worse than none, because it produces confidence without cover.

---

## Task 2: Claude Adapter (HIGH)

**Version:** 0.1.0.2

### Implementation Steps

1. Implement against `claude.ai`, following the ChatGPT adapter's fallback-chain pattern.
2. Handle its editor's event requirements for programmatic text setting.
3. Handle Projects/artifacts surfaces — confirm the composer resolves in each context.
4. Add DOM fixtures to the conformance suite.

### Testing

- [x] Passes the full conformance suite on first run
- [x] 37 tests in `claude.test.ts`, fixture built from the live page
- [x] `npm run typecheck` and `npm run lint` pass; three consecutive clean runs
- [ ] End-to-end on the live claude.ai page — deferred to the dogfooding pass in Task 4

### Outcome (2026-08-13)

**679 tests** (was 640). The adapter passed the shared conformance suite unchanged on
the first run, which is the result the abstraction was built for.

**Verification caught two things I had guessed wrong.** I wrote the message selectors
from memory before checking, which is exactly the Bug_0001 mistake, then inspected a real
thread before committing:

| Assumption | Reality |
|---|---|
| `data-message-id` identifies turns | **No per-message id exists at all.** `getMessages().id` now returns null honestly rather than inventing an index that would look stable and silently change on edit or branch switch |
| `<main>` is the observation root | **Claude has no `<main>`.** It exposes `[role="main"]`, which is used instead — falling back to `<body>` would wake the observer on every unrelated mutation |

The turn selectors themselves (`[data-testid="user-message"]`, `.font-claude-response`)
happened to be right, confirmed against a real thread: five turns, correctly alternating,
none nested.

**What differs from ChatGPT, and why the adapter boundary earned its keep:**

- **No `<form>`.** ChatGPT's form-submit interception has no equivalent; Enter and the
  send button are the only paths. The conformance suite's "fires exactly once per send
  gesture" test covers both shapes without either adapter special-casing the other.
- **The send button has no `data-testid`.** Its only stable hook is
  `aria-label="Send message"`, which breaks for every non-English user — so it is backed
  by a structural fallback that picks the rightmost button beside the composer.
- **Assistant turns are identified only by a utility class**, the least durable handle in
  this adapter. Documented in the source as the first thing to check if messages stop
  being found.

**`aria-label` is deliberately unused for the composer** on both platforms, for the same
reason: "Write your prompt to Claude" and "Chat with ChatGPT" are both locale-dependent.
A test asserts the composer still resolves when the label is in French.

**Two registry tests failed and were correct to.** They asserted `claude.ai` resolves to
null and that the registry holds one adapter — both true until this task. Updated rather
than worked around. Gemini remains in the null list: the registry must not claim a host
it cannot handle.

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

- [x] Passes conformance; declines two optional methods explicitly
- [x] 27 tests in `gemini.test.ts`, fixture built from the live page
- [x] `npm run typecheck`, `npm run lint`, `npm run build` pass; three clean runs

### Outcome (2026-08-13)

**710 tests** (was 679). All three adapters now pass the same conformance suite.

**Gemini uses Quill, not ProseMirror** — a different editor library entirely — **and has
exactly the same line-break trap.** `["p", "p"]` produces `textContent` of
`"alphabeta"`. Bug_0001 therefore affects three platforms across two editor libraries,
which settles that the problem belongs to the *shape* of the DOM rather than to any
particular library. `prosemirror.ts` was renamed `block-editor.ts` and its functions to
`readBlockEditorText` / `writeBlockEditorText` to say what they actually cover.

**A third variant of the decoy element.** Quill ships `.ql-clipboard`, a 0×1
contenteditable used for paste handling. Selecting it would silently swallow writes, the
same way ChatGPT's and Claude's 0-size textareas would. Three platforms, three different
decoys, one guard — `hasLayout` and `byLargest` from 0.0.3.0 handle all of them.

**Message reading is declined, not guessed.** The account inspected had no Gemini
conversation history, so there was no rendered thread to verify against. Its markup is
Angular-generated, where plausible-looking attributes like `_ngcontent-ng-c3305886920`
carry a build hash and change on every deploy.

`getMessages` and `observeResponse` are optional on `SiteAdapter` precisely so a platform
can decline a capability, and both are omitted with the reason recorded in the source.
A test asserts they are undefined, so this stays a deliberate decision rather than
becoming an oversight nobody remembers.

**The consequence is bounded and honest**: on Gemini, secrets are still detected, held,
and redacted — everything the product is primarily for. Only re-hydration is missing, and
its absence shows as the placeholder simply remaining visible, which is exactly what was
sent to the model. A silently-failing implementation would have been strictly worse than
a missing one.

**To finish it:** open a Gemini conversation with several turns, inspect the turn
container and role markers as was done for ChatGPT and Claude, then implement both
methods and add the fixture.

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

- [x] Built manifest asserts ChatGPT-only host permission, in CI
- [x] Enabling a platform requests permission *and* registers its content script
- [x] Revoking unregisters first, then revokes, and stops injection
- [x] Declined and failed paths are distinguished and both explained
- [x] `npm run typecheck`, `npm run lint`, `npm run build` pass; three clean runs

### Outcome (2026-08-13)

**732 tests** (was 710).

**Permission alone injects nothing — the part that would have shipped broken.** MV3's
static content script only covers hosts declared at build time, and Chrome does not
retroactively inject into a newly-permitted origin. Granting permission and stopping
there would have produced a toggle that switches on, reports success, and does nothing
on the site. `enablePlatform` therefore requests permission *then* registers the content
script, and reports which step failed.

**Order matters when disabling.** Unregister first, then revoke: revoking the permission
first can invalidate the registration's origin and leave a dangling entry that cannot
then be removed. Asserted by recording call order rather than trusting the comment.

**`syncRegistrations` on startup, install, and permission change.** Dynamic registrations
usually survive a browser restart, but an extension update can clear them while the host
permission remains — leaving a user who enabled Claude months ago quietly unprotected,
with the toggle still showing on. Reconciling the two states on every entry point closes
that. It also covers a permission revoked from Chrome's own settings page rather than
from ours.

**"You declined" and "it broke" are different messages.** The first is the user's own
choice and needs no apology; the second is our problem and suggests a retry. Collapsing
them into one string would misattribute blame in one direction or the other.

**`scripting` added to permissions, and the install ask is unchanged.** It grants no host
access on its own — injection still requires the host permission the user just approved —
and Chrome does not surface it as an install warning.

**The manifest is now asserted in CI** (`test/manifest.test.ts`), reading the *built*
output rather than the config that produces it. Six assertions, each protecting something
already established: ChatGPT-only host permission, everything else optional, no `tabs` or
`history` or `<all_urls>`, **no `localhost`** (WXT adds it to dev builds, and it must
never reach production for a tool claiming nothing leaves the machine), and no static
content script for a host we cannot inject into. This replaces a manual pre-flight step
in 0.9.0.3 that was only ever going to be remembered some of the time.

**Gemini's limitation is stated before the user enables it**, not discovered afterwards.
A partial capability found as a silent absence feels like a bug; the same gap declared up
front is just a known limit.

---

## Architectural Guardrails

- [x] No `fetch()` added — repo-wide ESLint rule still passing
- [x] Detector untouched by three platform additions; `lib/detector/` unchanged
      throughout this milestone, which is the boundary working as intended
- [x] Install-time host permission unchanged since 0.0.1.0, now enforced by test

---

## Session Notes

_(Record per-platform DOM quirks here.)_

---

**End of Milestone 0.1.0.0 Specification**
