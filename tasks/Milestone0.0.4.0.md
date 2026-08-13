# Milestone 0.0.4.0 - Approval Modal and Risk Badge

**Version:** 0.0.4.0
**Date Created:** 2026-08-12
**Date Started:** 2026-08-13
**Date Completed:** 2026-08-13
**Status:** Complete
**Based on:** PRD "Control", ARCHITECTURE.md pattern 4

The user-facing half of the product. Shadow-DOM isolated UI that shows what was found,
offers the redacted version, and never modifies a prompt without approval.

**Completing this milestone produces the first genuinely usable version of the product.**

---

## Version Information

**Current Version (at milestone start):** `0.0.3.5` (confirmed from package.json, 2026-08-13)
**Target Version:** `0.0.4.5`
**Git Branch:** `syamalatha-081326-0.0.4.0-ext` (created from `main` @ `9973512`)

---

## Progress Summary

**Completion:** 6 of 6 tasks complete (100%)

| Task                                  | Priority | Status  | Version | Verified |
| ------------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization      | SETUP    | Complete | 0.0.4.0 | branch ✓ |
| Task 1: Shadow DOM mount + Tailwind   | CRITICAL | Complete | 0.0.4.1 | 345 tests ✓ |
| Task 2: Approval modal                | CRITICAL | Complete | 0.0.4.2 | 386 tests ✓ |
| Task 3: Finding list + diff view      | HIGH     | Complete | 0.0.4.3 | 409 tests ✓ |
| Task 4: Risk badge (always-on)        | HIGH     | Complete | 0.0.4.4 | 427 tests ✓ |
| Task 5: Accessibility + keyboard flow | HIGH     | Complete | 0.0.4.5 | 460 tests ✓ |

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

**Status:** Complete (2026-08-13)

- Version at start confirmed `0.0.3.5`; milestone opens at `0.0.4.0`
- Milestone 0.0.3.0 merged to `main` via PR #3 (`9973512`) and pulled while `main` was
  checked out
- Branch `syamalatha-081326-0.0.4.0-ext` created from `main`
- Push deferred to milestone end, per the agreed cadence

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

- [x] Our styles cannot leak into the host page — verified in the built manifest
- [x] Panel is invisible to `document.querySelector`, so page CSS cannot select it
- [x] UI stacks above host overlays; host does not swallow page clicks
- [x] Dark mode follows the host page, not the OS
- [x] `npm run typecheck`, `npm run lint`, `npm run build` pass

### Outcome (2026-08-13)

**345 tests** (was 327). Content script restructured to `entrypoints/content/` so it can
carry its own stylesheet, mounted via WXT's `createShadowRootUi`.

**Style isolation verified in the build output, not assumed.** The built manifest shows
`content_scripts[0].css` is **empty** — the stylesheet is a web-accessible resource
fetched at runtime and injected into the shadow root only. Nothing our CSS defines ever
enters ChatGPT's cascade.

**A concern that turned out to be unfounded, checked rather than worked around.**
Tailwind v4 anchors its design tokens on `:root`, which does not exist inside a shadow
root — that would have silently broken every colour utility. Inspecting the generated CSS
showed Tailwind v4 already emits `@layer theme{:root,:host{…}}` and `html,:host{…}` in
preflight, so shadow DOM is supported out of the box. Building a workaround first would
have wasted effort and added a permanent maintenance burden.

**`isolateEvents: true` is load-bearing, not hygiene.** Without it, pressing Enter while
editing a redaction inside our modal would bubble to ChatGPT's own keydown handler and
submit the very prompt we are holding.

**Theme follows the host page, not the operating system.** A user running ChatGPT in dark
mode on a light-themed OS would otherwise get a bright white panel over a dark chat.
Resolution order is explicit host signal (`data-theme`, `color-scheme`, `.dark`/`.light`
class) first, OS preference only as fallback. The observer ignores unrelated `<html>`
attribute churn, which host pages produce constantly.

**Two properties the host element must have**, both tested: `z-index: 2147483647` so
nothing on the page can cover the panel, and `pointer-events: none` so the full-viewport
host does not make the entire page unclickable when idle. Interactive children opt back
in individually.

**Bundle size finding, raised and resolved within the task.** Mounting the first
component put the content script at 202.9 kB — React and react-dom loading on every
ChatGPT page, against the PRD requirement not to degrade host page performance. Raised
with the developer rather than decided unilaterally, since it reversed a stack choice
made at project start. Developer chose to switch immediately.

| | React | Preact |
|---|---|---|
| content script | 202.90 kB | **24.13 kB** |
| popup chunk | 191.71 kB | **11.77 kB** |
| total build | 426.32 kB | **62.95 kB** |

Native Preact via `@preact/preset-vite`, not `preact/compat` — no alias layer to
maintain and no mismatch between `@types/react` and the runtime. `@wxt-dev/module-react`
removed; no Preact equivalent exists, so the Vite plugin is configured directly.
Recorded as **ADR-006**.

**All 345 tests passed unchanged after the switch**, which is decent evidence the
component model is equivalent for what this project needs. The WXT starter's leftover
assets (`App.css`, `react.svg`, `wxt.svg`) were removed at the same time, and the popup
now states the local-only guarantee rather than showing a demo counter.

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

- [x] Send redacted → placeholder text is what reaches the adapter
- [x] Send original → original text unchanged, behind a two-step confirm
- [x] Edit → the user's exact edit is sent, not the suggestion
- [x] Escape dismisses without sending; the composer keeps the user's text
- [x] Double click cannot send twice
- [x] `npm run typecheck`, `npm run lint`, `npm run build` pass

### Outcome (2026-08-13)

**386 tests** (was 345). The pipeline is now end to end: typing a secret into ChatGPT
holds the submission, shows the modal, and sends whatever the user approves.

**The state machine lives outside the component**, in `panel-store.ts`, so the guarantee
that matters can be asserted directly: **no reachable state strands a held submission**.
A test loops every terminal action and asserts each returns to idle, including when the
send action throws — because leaving the modal open over a prompt the controller has
already released by its fail-open path would be its own trap.

**Escape and Cancel deliberately do NOT send.** The milestone text said Escape "releases
the pending submission", which reads two ways. Sending on dismissal is wrong for a
security tool: Escape is a wave-away gesture, and transmitting a secret in response to it
has the default exactly backwards. Nothing is lost either way — the submission was
cancelled before it left, so the user's text is still in the composer.

**Send-anyway takes two clicks.** Not a confirmation dialog, which would be obstruction,
but enough friction that it cannot happen by reflex while dismissing. It is never
blocked: a tool that can trap a prompt it disagrees with gets uninstalled, after which it
protects nobody.

**The modal never renders a secret value.** The summary is built from labels and counts,
and the preview shows the *redacted* text. A panel that displays the secret back to the
user — over a shared screen, in a recorded call — would be its own small leak. Asserted
by searching the whole modal's text content.

**A real bug found by the tests: the UI could miss a submission entirely.** `Panel`
subscribed to the store in `useEffect`, which runs after render — and the content script
creates the interceptor *after* `ui.mount()`. A submission held in that window would
never reach the UI, leaving the user staring at a prompt that silently refused to send.
Fixed by re-reading store state on subscribe.

**Test flakiness treated as a defect, not noise.** The first harness counted fixed ticks
to wait for Preact, which passes or fails depending on scheduling; one test failed in the
full run and passed in isolation. Rewritten to poll for conditions with `vi.waitFor`.
Verified with three consecutive clean runs — a flaky test is worse than no test, because
it trains everyone to re-run instead of investigate.

**`WxtVitest` is applied to the `ui` project only.** The plugin supplies WXT's `@/*`
aliases, but it also installs a fake `browser` global — which made
`test/environment.test.ts` fail, correctly. That test is the runtime half of ADR-004's
enforcement; letting the plugin satisfy it vacuously would have quietly retired the
guarantee. Nothing in the `lib` project imports through the alias, so excluding it costs
nothing.

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

- [x] Toggling a finding updates the preview immediately
- [x] Allowlisting reports the value and stops redacting it here
- [x] Masked previews never render the full secret
- [x] `npm run typecheck` and `npm run lint` pass; three consecutive clean test runs

### Outcome (2026-08-13)

**409 tests** (was 386).

**The "diff" is per-finding, not a text diff — a deliberate reversal of the plan.**
A conventional before/after view would put every secret back on screen at full length,
in a panel that may be over a shared screen or a recorded call. Each row instead shows
`AKIA…TIC7 → [REDACTED_AWS_ACCESS_KEY_ID_1]`, which is exactly what changes, at the
granularity the user actually decides at, without the value ever being legible. A test
asserts no full secret appears anywhere in the list.

**Masking reveals nothing below 16 characters.** Showing four characters from each end of
a ten-character secret leaks eighty percent of it. Short values are identified by label
and position instead, which is sufficient — a prompt rarely contains two secrets of the
same kind. At most eight characters are ever revealed regardless of length.

**One row per distinct value, not per occurrence.** A key pasted three times is one
decision; showing it three times would be three chances to get confused for no added
information. The row carries a `×3` count instead. Toggling it toggles every occurrence,
because they are the same choice.

**Everything starts selected.** The safe option has to be the default one — a user who
dismisses the dialog without reading it should still be protected.

**Allowlisting also deselects the finding in the current prompt.** Recording "this value
is fine" while still replacing it in the prompt in front of you would be incoherent.

**Advisory findings are collapsed behind a disclosure.** Letting a list of email
addresses push actual credentials off screen would invert the priority the tier system
exists to express. Blocking findings are always visible without expanding anything.

**Toggling never overwrites an in-progress edit.** The redacted text is re-derived on
every selection change, but the draft is only re-seeded while reviewing — having your
manual edit wiped because you unticked a checkbox would be maddening.

**A bug caught by tests that typecheck would also have caught**, had I run it first:
`valueFor(state, …)` was passed the whole panel state where it expected the submission.
Worth the note as a process point — the type checker was the cheaper of the two signals
and I reached for the slower one.

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

- [x] Badge appears, changes level, and disappears as the draft changes
- [x] Sits above the composer, clear of send / attach / dictation controls
- [x] Hides when the composer disappears (SPA navigation)
- [x] Inserts nothing into the host page
- [x] `npm run typecheck` and `npm run lint` pass; **eight** consecutive clean test runs

### Outcome (2026-08-13)

**427 tests** (was 409). The whole product loop is now visible: the badge tracks the
draft continuously, and the modal appears only when a submission is actually held.

**Risk state has its own store**, separate from the modal's. The two are orthogonal —
risk follows whatever is in the composer, the modal exists only for a held submission —
and merging them would mean every keystroke re-rendering the modal's state machine.

**Positioned from our own overlay, never injected into the host DOM.** Inserting an
element next to ChatGPT's composer would shift its layout, and a tool that visibly
rearranges the page it is protecting reads as breakage rather than help. The cost is
having to follow the composer ourselves as it grows, scrolls, and gets replaced —
handled by `useAnchor` with resize, scroll, `ResizeObserver`, and `MutationObserver`.

**Placed above the composer, deliberately.** ChatGPT's send, attach, and dictation
controls all sit along the bottom edge; covering any of them would put the extension
between the user and their work.

**Clicking opens a popover, never submits.** It lists masked findings and offers
"Redact now", which rewrites the composer *without sending* — letting someone clean up a
draft on their own initiative rather than only when interrupted. The badge hides entirely
while the approval modal is open, since two surfaces describing the same findings is
noise and the modal is the one demanding a decision.

**Paste risk now surfaces here** rather than in a dialog of its own. Nothing has left the
machine at paste time, so opening the badge's popover is the proportionate response.

**A flaky test turned out to be a real bug, twice over.** One test failed roughly one run
in four, and only in the full suite:

1. `schedule()` returned early when a frame was already pending, **dropping** that
   update. During a resize burst the final event could be discarded, parking the badge
   at a stale position until something else moved it. Fixed by coalescing without
   dropping.
2. The real defect: the "last measurement" cache was a closure variable that desyncs
   from state whenever the effect re-runs. On re-run it resets to empty while state
   still holds the old rect — so a subsequent *null* measurement compares equal, is
   skipped, and the badge is stranded over a composer that no longer exists. Replaced
   with a functional state update comparing against actual state.

Both would have shipped as intermittent, hard-to-reproduce misbehaviour. Verified with
eight consecutive clean full runs rather than the usual three, given how intermittent
it was.

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

- [x] Entire flow completable without a mouse
- [x] Focus never escapes the modal while open, and returns to the composer on close
- [x] Contrast passes WCAG AA in light and dark — asserted, not eyeballed
- [x] `npm run typecheck`, `npm run lint`, `npm run build` pass; six consecutive clean runs

### Outcome (2026-08-13)

**460 tests** (was 427).

**Contrast is a test, not a checklist item — and it immediately failed.** `contrast.test.ts`
parses the *shipped* stylesheet (not a copy, which would drift) and computes WCAG ratios
for every foreground/background pair in both themes. On first run it caught a real
defect: light-theme danger text measured **4.41:1**, just under the 4.5 AA threshold for
body text. Fixed by moving from red-600 to red-700. Nobody re-checks contrast by eye
after changing a hex value; now nobody has to.

The suite also asserts both themes define the *same* token set — a token present in one
and missing in the other renders as an unresolved `var()`, i.e. invisible text in exactly
one theme, which is the kind of bug that ships.

**Focus returns to the composer on close.** Without it a keyboard user is dumped at the
top of the document and has to navigate back to what they were typing. The trap reads
`document.activeElement` *from the host page* when arming — our UI lives in a shadow
tree, so that is the composer rather than anything of ours.

**Enter is deliberately not bound to the primary action**, contrary to the task
description. The modal is summoned BY pressing Enter, so a focused Send button or a
global Enter handler would let a second reflexive keypress send before the user has read
anything. The dialog itself takes focus instead; Tab reaches the buttons, and Enter
activates them natively once focused. Full keyboard operation, without a foot-gun.

**Tab detection uses `event.target`, not `activeElement`.** Inside a shadow root
`document.activeElement` reports the shadow *host*, so the document's view cannot
distinguish which of our controls has focus. The keydown originates at the focused
element, so `target` answers it directly.

**One order-dependent test failure, diagnosed rather than papered over.** The Tab test
passed alone and failed with any test before it. Instrumenting rather than guessing
showed the cause: `open()` waited for the modal to *exist*, but the trap attaches in an
effect that runs later, leaving a window where the dialog is on screen but not listening.
Irrelevant in a browser — no human presses Tab that fast — but a real source of flaky
tests. `open()` now waits for the trap to take focus, which is the deterministic signal
that it is armed.

---

## Architectural Guardrails

- [x] No `fetch()` added — repo-wide ESLint rule still passing
- [x] All UI inside the shadow root; `content_scripts.css` empty in the built manifest
- [x] No full secret values rendered or logged — asserted across modal, list, and popover
- [x] Escape and every error path release or return the pending submission

---

## Session Notes

_(Record UI decisions and any host-page layout conflicts here.)_

---

**End of Milestone 0.0.4.0 Specification**
