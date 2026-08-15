# Milestone 0.6.0.0 - Onboarding and First-Run Experience

**Version:** 0.6.0.0
**Date Created:** 2026-08-12
**Date Started:** 2026-08-14
**Date Completed:** 2026-08-14
**Status:** Complete
**Based on:** PRD success criteria (week-4 retention ≥ 40%)

A passive security tool has a structural problem: when it works, nothing happens. Users
who install it and see nothing uninstall it. Onboarding exists to solve exactly that.

---

## Version Information

**Current Version (at milestone start):** `0.5.0.4`
**Target Version:** `0.6.0.4`
**Git Branch:** `syamalatha-081426-0.6.0.0-ext`

---

## Progress Summary

**Completion:** 4 of 4 active tasks complete (100%). One deferred.

| Task                                | Priority | Status   | Version | Verified     |
| ----------------------------------- | -------- | -------- | ------- | ------------ |
| Task 0: Milestone Initialization    | SETUP    | Complete | 0.6.0.0 | branch ✓     |
| Task 1: Install → first catch demo  | CRITICAL | Complete | 0.6.0.1 | 1203 tests ✓ |
| Task 2: Trust / privacy explainer   | HIGH     | Complete | 0.6.0.2 | 1222 tests ✓ |
| Task 3: Ongoing value surfacing     | HIGH     | Complete | 0.6.0.3 | 1241 tests ✓ |
| Task 4: Uninstall feedback          | MEDIUM   | Deferred | —       | see below    |

### Two things this milestone could not finish, and why

Both are blocked on the same thing: **the product has no public presence yet.**
Neither is a design problem, and neither should be guessed at.

**Task 4, uninstall feedback — deferred 2026-08-14.** `setUninstallURL` needs a
page someone hosts, and ADR-001 says there is no backend. The mechanism itself is
defensible: the browser navigates a tab after the extension is gone, so it is not
a request *from* the extension. But it points somewhere real, and visiting it
reveals an IP and a timestamp to whoever runs it — which is a different promise
from the one every other screen in this product makes.

Deferred rather than dropped, because it is the only honest signal separating the
two retention hypotheses the PRD rests on: *too many false positives* versus *did
nothing visible*. Guessing between those after launch would be expensive.

Revisit at **0.9.0.0**, alongside the store listing, when the hosting question has
an answer. Whatever it points at, the wiring must attach no identifier, no
version, and nothing carried over from the extension.

**The rating link, inside Task 3.** `STORE_REVIEW_URL` is `null`; the extension
has not been submitted. The acknowledgement ships and works — that is the part
which earns retention — but the ask has nowhere to point. Set the constant at
launch. A test pins the current value so flipping it is deliberate.

---

## Overview

**Objective:** Every new user sees the extension catch something within 30 seconds of
install, and understands within one screen that nothing leaves their machine.

**Estimated Effort:** 3–5 hours

**Dependencies:** 0.5.0.0

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch `syamalatha-MMDDYY-0.6.0.0-ext`, Date Started.

---

## Task 1: Install to First Catch (CRITICAL)

**Version:** 0.6.0.1

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

- [x] Fresh install opens the welcome page exactly once
- [x] Demo uses the real detector, not a mock
- [x] Full flow completable in under 30 seconds
- [x] Update does not re-trigger the welcome page

### Success Criteria

- [x] The user has seen a real catch before they ever reach a real chat

### Implementation Notes

`entrypoints/welcome/` (page, demo, styles) plus the `onInstalled` trigger in
`background.ts`. 19 new tests (1184 → 1203).

**The demo is the real thing, not a reproduction.** It imports the production
`detect()`, builds a real `PanelStore`, and renders the real `ApprovalModal` —
the same components the content script mounts. Only the *submission* is
simulated, since there is no chat here to submit to: the send callbacks record
what would have gone instead of releasing an event, and the text they receive
comes from the real redaction path.

That matters beyond tidiness. A welcome page demonstrating a mock would keep
working perfectly after the product broke, and would be teaching a new user
something false about a security tool.

The stylesheet is imported from `entrypoints/content/style.css` for the same
reason: the modal here has to look exactly like the one the user meets on
chatgpt.com a minute later, and a second set of tokens would drift.

**The sample announces itself as fake.** `SYNTHETIC` sits inside the AWS key
where entropy would be, and the host is `db.internal`, which resolves nowhere.
This text ends up in every screenshot anyone takes of onboarding, and a demo
that normalises pasting live credentials into a tool teaches the opposite of the
lesson. Asserted.

**Under 30 seconds is a typing budget.** It is met by pre-filling the sample so
nothing has to be typed and the first real catch is one click away — not by
asking the user to hurry. No account, no signup, no email; pinned by a test that
checks for inputs rather than for copy.

#### Two things worth recording

1. **A real bug in the store subscription, found by the first failing test.**
   The page subscribed with `store.subscribe(setState)`. The store keeps
   listeners in a `Set` and unsubscribes by identity, so subscribe and
   unsubscribe shared one identity — and when the effect ran twice, the first
   run's cleanup deleted the entry the second run had just added. The store
   reached `active` and the modal never appeared, with no error anywhere. An
   inline arrow gives each subscription its own identity. Worth knowing the
   same shape exists in `Panel`, `RefineButton`, and `RiskIndicator`.

2. **The heading no longer states a finding count.** It said "two secrets"; the
   detector finds three, having also caught the internal hostname. Copy that
   counts what a rule set produces goes stale the first time a rule changes.

---

## Task 2: Trust and Privacy Explainer (HIGH)

**Version:** 0.6.0.2

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

- [x] Claims on the page exactly match actual behavior (re-verify before every release)
- [x] The DevTools verification instruction genuinely produces an empty Network tab

### Implementation Notes

`components/PrivacyStatement.tsx`, rendered by both the welcome page and the
options page. 19 new tests (1203 → 1222).

**"Re-verify before every release" is a note that will be skipped**, so
`test/privacy-claims.test.ts` does the verifying. Each claim is cross-checked
against something real:

| Claim | Checked against |
| --- | --- |
| sends nothing | built bundle has no transport; no hedging words in the copy |
| ChatGPT only at install | built manifest's `host_permissions` |
| Claude/Gemini opt-in | `PLATFORMS` registry ↔ `optional_host_permissions` |
| allowlist as hashes | `lib/policy/allowlist.ts` uses SHA-256 |
| real values memory-only | `lib/vault` uses `storage.session`, never `.local` |
| AI runs on-device | no `fetch`/vendor host anywhere in `lib/model` |
| redacted before the model | `lib/refine/guard.ts` exposes `prepareForModel` |

It also fails on a permission the statement does not account for, and on hedging
language — "except", "unless", "anonymous". That last one is how this claim
would actually die: not by someone deleting it, but by someone qualifying it.

**One statement, in one place.** The options page previously carried its own
hand-written version, and its test carried a third copy of the same wording —
three statements kept in agreement by memory, of which only one was ever going
to be updated. All three now read from `PRIVACY_CLAIMS`.

**The verification invitation is tested as an instruction, not as copy.** The
e2e smoke test now follows the same four steps the screen prints, including
step 4: the catch has to actually happen. A Network tab that stays empty because
the extension did nothing would prove nothing at all.

The screen also warns that ChatGPT's own requests will still appear. Without
that line, the first thing a user sees after following the instructions is a
busy Network tab, and an honest claim reads as a lie.

**The source link is `null` and renders nothing.** The repository is not
confirmed public, and "read the source" leading to a 404 reads as something to
hide — on the one screen whose entire job is credibility. Flip `SOURCE_URL` when
the repo is public; a test pins the current state so it is a deliberate change.

---

## Task 3: Ongoing Value Surfacing (HIGH)

**Version:** 0.6.0.3

### Implementation Steps

1. Badge text on the toolbar icon reflecting recent catches.
2. Popup leads with the catch count — the answer to "why do I still have this installed."
3. A milestone moment at the first genuine catch: brief, non-intrusive acknowledgement
   with an unobtrusive path to rate the extension. Store rating is a launch-critical
   input, and the moment right after a real catch is when goodwill is highest.
4. Never nag. One rating prompt, ever, and only after a real catch.

### Testing

- [x] Badge updates on catch
- [x] Rating prompt appears at most once, and never before a genuine catch
- [x] Nothing is transmitted by any of this

### Implementation Notes

`lib/badge/`, background wiring, and a restructured popup. 19 new tests
(1222 → 1241).

**The badge watches storage, not messages.** `recordCatch` already writes to
`.local`, so the background listens for that key changing rather than adding a
second path from the content script. One source of truth, and the badge is
correct whichever surface recorded the catch.

**It shows a recent count, not a lifetime total.** A lifetime number stops
moving and becomes wallpaper; "3 this week" is a fact about now, and it returns
to nothing when the extension has genuinely done nothing. That honesty is what
makes the number worth trusting — a badge that always shows something big is an
advert. Empty at zero, capped at `99+`.

**The popup leads with the count**, which is the answer to "why do I still have
this installed" and the only thing a returning user opens it to see. It
previously sat below the status line as one of two equal tiles. At zero it says
so plainly rather than padding, because one inflated number makes every other
number untrustworthy.

**The first-catch moment cannot fire early.** It is gated on `totalCatches > 0`,
and only the real interception path calls `recordCatch` — the onboarding demo
does not, so pressing "try it" on the welcome page cannot trigger it. A single
boolean, `firstCatchAcknowledged`, rather than a counter: the requirement is
"once", and a counter invites someone to raise the threshold later.

**No rating link yet.** `STORE_REVIEW_URL` is `null` because the extension has
not been submitted, and a "Rate it" button leading nowhere would spend the one
prompt this product ever gets on nothing. The acknowledgement still shows — that
is the part which earns retention; the rating ask is the part that needs
somewhere to go. Set the constant at launch; a test pins the current value.

Nothing here transmits: it is a local read of a local counter, with no image,
iframe, or beacon anywhere near it. Asserted.

---

## Follow-up: the store subscription sweep

Done 2026-08-14, after Task 3. 20 tests (1241 → 1261).

The bug found on the welcome page in Task 1 existed in **all four stores** —
`panel`, `risk`, `refine`, and `clarify`. Each kept listeners in a `Set` and
removed them by identity, so subscribing the same function twice collapsed into
one entry that the first cleanup then deleted. Five call sites passed a state
setter directly and were one extra effect run away from silently unsubscribing.

**Fixed in `subscribe`, not at the call sites.** Each subscription now wraps the
listener in a fresh closure, so it has its own identity. Patching the five
callers would have left the next one to rediscover it by writing the obvious
thing.

`components/store-contract.test.ts` asserts the same five properties against all
four stores — they were written independently and had already drifted in the
details, so this is the first place the shared promise is stated once. **Verified
by reverting `panel-store` and watching two of its cases fail**, then restoring:
a contract test nobody has seen fail is a contract test nobody knows is wired up.

Worth noting what made this findable at all. The failure is invisible from the
store's side — state advances correctly, no error is thrown, and only the UI is
wrong. It surfaced because a test asserted on the rendered modal rather than on
`store.get()`.

---

## Task 4: Uninstall Feedback — DEFERRED to 0.9.0.0

**Status:** Deferred 2026-08-14. Blocked on hosting, not on design — see
"Two things this milestone could not finish" above for the reasoning.

The specification below is unchanged and still correct. It is kept in full so
that whoever picks it up at 0.9.0.0 inherits the thinking rather than
re-deriving it.

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

_Checked 2026-08-14, with Task 4 deferred._

- [x] **Welcome demo uses the real detector** — it imports the production
      `detect()`, a real `PanelStore`, and the real `ApprovalModal`. Only the
      submission is simulated, since there is no chat to submit to
- [x] **No prompt content leaves the device** — `test/no-network.test.ts` and
      the e2e suite both still pass; the welcome page is the only new surface
      that touches a draft and it has no transport
- [n/a] **Uninstall URL carries no identifiers** — no uninstall URL is set.
      This guardrail becomes live again the moment Task 4 is picked up, and is
      restated in that task's own testing list
- [x] **Privacy claims verified against actual behavior** — mechanically, by
      `test/privacy-claims.test.ts`, rather than by a note to re-check

---

## Session Notes

_(Record onboarding copy iterations and any measured drop-off here.)_

---

**End of Milestone 0.6.0.0 Specification**
