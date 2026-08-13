# Milestone 0.0.3.0 - Site Adapter Layer and Interception

**Version:** 0.0.3.0
**Date Created:** 2026-08-12
**Date Started:** 2026-08-12
**Date Completed:** 2026-08-13
**Status:** Complete
**Based on:** ARCHITECTURE.md pattern 3

Connect the detector to a real page. Build the ChatGPT adapter and the interception
layer that catches submit and paste before anything leaves the browser.

---

## Version Information

**Current Version (at milestone start):** `0.0.2.6` (confirmed from package.json, 2026-08-12)
**Target Version:** `0.0.3.5`
**Git Branch:** `syamalatha-081226-0.0.3.0-ext` (created from `main` @ `099e81a`)

---

## Progress Summary

**Completion:** 6 of 6 tasks complete (100%)

| Task                                   | Priority | Status  | Version | Verified |
| -------------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization       | SETUP    | Complete | 0.0.3.0 | branch ✓ |
| Task 1: SiteAdapter interface + registry| HIGH    | Complete | 0.0.3.1 | 240 tests ✓ |
| Task 2: ChatGPT adapter                | CRITICAL | Complete | 0.0.3.2 | 263 tests ✓ |
| Task 3: Submit interception            | CRITICAL | Complete | 0.0.3.3 | 285 tests ✓ |
| Task 4: Paste interception             | HIGH     | Complete | 0.0.3.4 | 305 tests ✓ |
| Task 5: Live-scan pipeline + debounce  | MEDIUM   | Complete | 0.0.3.5 | 327 tests ✓ |

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

**Status:** Complete (2026-08-12)

- Version at start confirmed `0.0.2.6`; milestone opens at `0.0.3.0`
- Milestone 0.0.2.0 merged to `main` via PR #2 (`099e81a`) and pulled while `main` was
  checked out, so this branch starts from a trunk containing the detector
- Branch `syamalatha-081226-0.0.3.0-ext` created from `main`
- Push deferred to milestone end, per the agreed cadence

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

- [x] Unknown host → null, no throw, no console noise
- [x] Registry unit-tested with fake hostnames, including lookalike domains
- [x] Fallback resolution tested: ordering, early exit, throwing strategy, hidden nodes
- [x] `npm run typecheck` and `npm run lint` pass (exit 0)

### Outcome (2026-08-12)

**240 tests** (was 212). The `SiteAdapter` interface already existed from milestone
0.0.1.0; the substance of this task is the infrastructure that makes DOM churn
survivable.

**`resolve.ts` — fallback selector chains.** A single hardcoded selector is a time bomb:
when it breaks, the extension silently stops protecting the user while still looking
installed and healthy. Every lookup is now a chain of independent strategies tried in
order of durability — semantic signals (role, aria, element type) first, generated class
names last — and the chain reports *which* strategy succeeded. That turns "ChatGPT
changed something" into a specific diagnosable fact, and it is the data the health check
in 0.2.0.1 surfaces to the user.

Three properties that matter, all tested:
- A strategy that throws (invalid query, detached node) is treated as "not found" and
  the chain continues. One broken strategy must never take down the ones after it.
- `isUsable` rejects detached, `hidden`, and `aria-hidden` elements. A query can succeed
  against a leftover node from a previous route; writing into one would silently do
  nothing and the user would conclude the extension is broken.
- `byLargest` picks the biggest match by rendered area, because pages often keep an
  offscreen or collapsed duplicate composer around and the real one is invariably
  largest.

**Registry hardened against a real security edge case.** Hostname matching now
normalises case, strips `www.` and any port, and anchors the suffix match on a leading
dot. Without that anchor, `notchatgpt.com` or `chatgpt.com.evil.net` would match a
supported host — and the manifest is not the only gate, since a future dynamic
registration would go through this path. Tested explicitly.

**Test projects restructured.** Adapters touch the DOM, so they cannot run in the node
project. The `lib` project is now scoped to `lib/detector/**`, `lib/policy/**`, and
`test/**`; adapters run under jsdom in the `ui` project. Keeping adapters *out* of the
node project is what stops ADR-004's guarantee from being quietly diluted from "the
detector is pure" to "most of lib/ is pure".

**Known cost:** jsdom adds ~45s of environment startup to a full run, against ~150ms of
actual test execution. Use `npm run test:lib` for the fast inner loop while working on
the detector.

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

- [x] Composer resolves via each fallback strategy in turn (id → role → ProseMirror)
- [x] `setText()` dispatches an input event so the editor re-syncs
- [x] Disposers detach every listener
- [x] Adapter returns null on an unrecognisable page without throwing
- [x] `npm run typecheck` and `npm run lint` pass (exit 0)

### Success Criteria

- [x] Adapter failure degrades to "extension does nothing", never to a broken chat

### Outcome (2026-08-13)

**263 tests** (was 240). Selectors verified against the live chatgpt.com DOM rather than
guessed. Four findings materially changed the implementation:

**1. The composer is a ProseMirror contenteditable DIV, not a textarea.**
`id="prompt-textarea"`, `role="textbox"`, `class="ProseMirror"` — the id is misleading.

**2. The page ships a decoy 0×0 `<textarea name="prompt-textarea">`.** It is connected,
not `hidden`, and not `aria-hidden`, so `isUsable` from Task 1 accepted it — writing into
it would have silently done nothing while appearing to succeed. Added `hasLayout` and
`byVisibleSelector`; the test fixture reproduces the decoy so this cannot regress.
Live inspection caught a bug that no amount of jsdom testing would have.

**3. Clicking send fires TWO intents.** The send button carries no `type` attribute, so
inside a `<form>` it defaults to `type="submit"` — one click produces our click event and
then a separate submit event. Unfixed, the user would be asked to approve one prompt
twice. Deduplicated per gesture.

**4. The self-submit guard had to move off the event object.** `release()` clicks the
real send button, and that click cascades into a *separate* submit event carrying none
of the first event's properties. The original `Symbol` marker on the event let the
cascade through, so the extension intercepted its own submission — an infinite loop in
production. Replaced with a module-level flag spanning the whole cascade. Both bugs were
caught by tests, not by inspection.

**`setText` uses `execCommand('insertText')`,** which routes through the browser's native
editing pipeline so ProseMirror treats it as an ordinary user edit. Direct `textContent`
assignment was observed to stay in sync on the live page (ProseMirror's mutation observer
picks it up), but that is undocumented behaviour and the failure mode is the worst one
this product has: a stale editor document means ChatGPT sends the ORIGINAL text while the
user believes it was redacted. Assignment is kept only as a fallback.

**`aria-label` is deliberately unused for the composer.** Its value is "Chat with
ChatGPT", which changes with the user's locale.

**IME composition is handled** — Enter that commits a Japanese or Chinese candidate is
not a submit. Getting this wrong would make the extension actively hostile to those users.

**`getMessages()` returns empty by design.** The inspected page was a fresh conversation
with no turns rendered, so message DOM could not be verified. Guessing at selectors would
be worse than returning nothing; re-hydration (0.0.5.0) is the first consumer and can be
built against a page that has messages.

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

- [x] Clean prompt submits untouched; low-tier findings alone never block
- [x] Prompt with a synthetic AWS key is held
- [x] Six fault-injection cases, each confirming the submission still goes through
- [x] Shift+Enter and IME composition covered in the adapter (Task 2)
- [x] `npm run typecheck` and `npm run lint` pass (exit 0)

### Success Criteria

- [x] Fail-open verified by deliberate fault injection at every stage

### Outcome (2026-08-13)

**285 tests** (was 263). `createInterceptor` wires adapter intents to the detector.

**The control flow is arranged around failing open, not merely wrapped in try/catch.**
Everything that can throw happens *before* the event is cancelled, so an exception leaves
the host page behaving exactly as if the extension were not installed. Cancelling first
and computing afterwards would look equivalent and would strand the user's prompt on any
bug.

**The subtle case: the approval UI throwing after cancellation.** By then the submission
is already prevented, so doing nothing would trap the prompt permanently — the worst
outcome this product can produce. That path releases immediately, and is tested.

Fault injection covers `getComposer` throwing, `getComposer` returning null, `getText`
throwing, `getSettings` throwing, the allowlist predicate throwing, and the approval UI
throwing. Every one asserts the submission proceeds.

**Kill switches are checked first**, so a disabled extension costs one boolean read.
`enabled: false` and a paused host both short-circuit before any DOM or detector work.

**Settings are read through a getter, not captured at construction**, so a change takes
effect on the next submission without re-registering listeners or reloading the page.
Tested by flipping `enabled` between two submissions.

**`warn` mode notifies without cancelling**, for users who want to be told rather than
stopped. The send functions become no-ops in that mode since the prompt is already away.

**A failing test corrected a wrong assumption of mine, not a bug.** "Respects a disabled
rule" used `AWS_ACCESS_KEY_ID=AKIA…`, which is caught by *two* rules — the AWS-specific
one and the generic secret-assignment rule — so disabling one still blocked. That is
defense in depth working as intended. The test now uses a bare key to isolate the rule,
and a second test pins the overlap behaviour explicitly so nobody later "fixes" it.

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

- [x] Pasting a synthetic `.env` reports both planted secrets
- [x] Very large paste does not block the UI thread
- [x] Paste of clean text is unaffected; low-tier findings alone do not fire
- [x] `npm run typecheck` and `npm run lint` pass (exit 0)

### Outcome (2026-08-13)

**305 tests** (was 285). `createPasteWatcher` plus `onPaste` on the adapter.

**Design decision — paste never blocks.** The milestone said "surface immediately", and
the right reading is *notify*, not *cancel*. Nothing has left the machine when text is
pasted into a textbox; the gate is submission. Cancelling a paste would add real risk —
a failure in our handler could break pasting entirely — in exchange for no security
benefit. The adapter listens in the bubble phase and never calls `preventDefault`, and a
test asserts the event is not cancelled.

What paste-time detection buys is timing: the user is told while the context is still in
their head, rather than being stopped later at the moment they press send.

**The scan is deferred to a macrotask**, so it is off the paste's critical path entirely.
The paste lands and the caret settles before any work begins, whatever the payload size.
A test asserts the handler returns before the scan has run.

**Above 512KB, paste scanning is skipped rather than throttled.** Detection runs at about
0.4ms per 10KB, so a multi-megabyte paste would cost hundreds of milliseconds on the main
thread and produce a visible stall. Skipping is safe *because this is early warning and
not the guarantee* — submit-time interception still scans the entire prompt before
anything can leave. Given a janky tab versus a slightly later warning, the later warning
wins. Milestone 0.2.0.4 owns the performance budget and can chunk the scan properly.

**Only the pasted chunk is scanned, not the whole composer.** Cheaper, and more precise:
the warning is about what the user just did, not about text they had already reviewed.

**`onPaste` is optional on the interface.** A platform where the composer cannot be
identified reliably should omit it rather than fire on every paste in the page;
`createPasteWatcher` returns a no-op disposer in that case.

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

- [x] A burst of five keystrokes produces exactly one scan
- [x] Risk level tracks the draft: none → low → high, and back
- [x] Scan on a ~10KB draft stays inside the budget
- [x] `npm run typecheck`, `npm run lint`, `npm run build` pass

### Outcome (2026-08-13)

**327 tests** (was 305). `createLiveScanner` plus `onInput` on the adapter.

**This is the feature that replaced the original "check my prompt" button.** The
concept the project started from had the user click a control before submitting; that was
rejected during planning because nobody remembers to press it. Protection that depends on
the user thinking of it is protection that does not happen. The scanner is always on and
purely advisory — it never touches the composer, never cancels anything, and has no
influence on whether a submission is held.

**The cache stores a hash, not the draft.** Remembering the previous text in a
module-level variable would mean holding a long-lived copy of whatever secrets the user
typed — exactly the quiet accumulation this product exists to prevent. FNV-1a is enough
to answer "unchanged?" and forgets the content. It is not a security primitive and does
not need to be: a collision costs one skipped rescan, and the next keystroke corrects it.
Length is compared alongside the hash so a collision cannot suppress a rescan on text of
a different size.

**Emissions are filtered on level AND counts.** Two different drafts that both contain
one high-tier finding produce an identical badge, so re-emitting would only make it
flicker. A count change does emit, because "1 secret" and "2 secrets" are different
things to show.

**`onSlowScan` receives timing and length only — never text, never a value.** A
diagnostic that leaks the thing it is diagnosing would be worse than no diagnostic, and a
test asserts the payload keys are exactly `durationMs` and `length`.

**250ms trailing debounce**, with the pending timer cancelled on dispose so a teardown
mid-keystroke cannot fire a scan against a detached page.

---

## Architectural Guardrails

- [x] No `fetch()` added — repo-wide ESLint rule still passing
- [x] Adapter is the only module touching host DOM
- [x] No detected values logged; slow-scan diagnostics carry no text
- [x] Fail-open verified by fault injection across submit, paste, and live scan

---

## Session Notes

_(Record ChatGPT DOM findings and selector fallbacks here — this is the section most
likely to be needed in six months.)_

---

**End of Milestone 0.0.3.0 Specification**
