# Milestone 0.4.0.0 - Clarify With Context

**Version:** 0.4.0.0
**Date Created:** 2026-08-13
**Date Started:** 2026-08-14
**Date Completed:** 2026-08-14
**Status:** Complete
**Based on:** Original product concept, "Feature 2: Clarify With Context"

Resolve vague references — "add this over there", "make it like before" — against the
conversation already on screen, and ask the user to confirm the interpretation before
sending.

---

## Version Information

**Current Version (at milestone start):** `0.3.0.5`
**Target Version:** `0.4.0.4`
**Git Branch:** `syamalatha-081426-0.4.0.0-ext`

---

## Progress Summary

**Completion:** 5 of 5 tasks complete (100%)

| Task                                  | Priority | Status   | Version | Verified      |
| ------------------------------------- | -------- | -------- | ------- | ------------- |
| Task 0: Milestone Initialization      | SETUP    | Complete | 0.4.0.0 | branch ✓      |
| Task 1: Vague-reference detection     | HIGH     | Complete | 0.4.0.1 | 1012 tests ✓  |
| Task 2: Context assembly from the chat| CRITICAL | Complete | 0.4.0.2 | 1033 tests ✓  |
| Task 3: Interpretation and confirmation| CRITICAL| Complete | 0.4.0.3 | 1077 tests ✓  |
| Task 4: Restraint tuning              | HIGH     | Complete | 0.4.0.4 | 1089 tests ✓  |

---

## Overview

**Objective:** When a prompt leans on something earlier in the same chat, the user sees
what it will most likely be taken to mean, and confirms or corrects it before sending.

**What this is actually for — a correction to the original reasoning.** The PRD
originally dismissed this as "low value; the model already sees the conversation". That
was right about information and wrong about purpose. The model does have the history —
but it **resolves ambiguity silently, and sometimes wrongly**, and the user only finds
out after a wasted round-trip. The value is not telling the model something it lacks; it
is showing the *user* an interpretation before it is acted on. Two cases where it earns
its place:

- A long conversation, where early context has fallen out of the model's effective
  attention entirely
- A reference the model will resolve plausibly but incorrectly, costing a full
  round-trip to discover

**Estimated Effort:** 6–8 hours

**Dependencies:** 0.3.0.0

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch, Date Started.

---

## Task 1: Vague-Reference Detection (HIGH)

**Version:** 0.4.0.1

### Description

Decide whether a prompt needs clarifying at all — cheaply, and without a model.

### Implementation Steps

1. Local heuristics first: unresolved demonstratives ("this", "that", "there", "the
   above", "like before") with no antecedent in the prompt itself.
2. Require the conversation to have prior turns. On a fresh chat there is nothing to
   resolve against and the feature must stay silent.
3. Skip when the prompt is already specific — a long, detailed instruction that happens
   to contain "this" does not need help.
4. No model call unless the heuristic fires. Most prompts should never reach one.

### Testing

- [x] Fires on "add this over there and make it cleaner"
- [x] Silent on a fresh chat with no history
- [x] Silent on a specific, self-contained prompt

### Implementation Notes

`lib/clarify/` — pure, in the node test project alongside the detector, so the
"no model, no DOM" half of this feature cannot quietly acquire either.

- `references.ts` — masks code (a `this` in a snippet is a keyword, not a
  gesture), then scans three reference kinds: bare demonstratives, locatives,
  and prior-work phrases. Demonstratives and locatives are dropped when the
  draft already named something concrete before them; prior-work phrases skip
  that check because nothing in a draft can resolve "like before".
- `index.ts` — the gate. History is checked before scanning, so the feature is
  structurally incapable of appearing on a first message.

**Two decisions worth revisiting in Task 4:**

1. The self-contained gate is applied to prior-work phrases too, which
   suppresses "Like before, <four lines of precise instruction>". That is the
   restrained reading, not the obviously correct one.
2. `LONG_PROMPT_WORDS = 40` and `SELF_CONTAINED_ANCHORS = 2` are desk guesses.
   Like the detector's corpus metrics, they should not be mistaken for measured
   values.

Every demonstrative heuristic resolves ties toward silence — including reading
an unknown word after "this" as a noun, which is why `PRONOUN_FOLLOWERS` is a
closed list rather than a suffix rule ("update this server" must not fire).

---

## Task 2: Context Assembly (CRITICAL)

**Version:** 0.4.0.2

### Description

Gather the conversation the reference points at, using `getMessages()` from 0.0.5.0.

### Implementation Steps

1. Read recent turns, most recent first, up to a token budget.
2. **Redact the assembled context before it reaches the model.** Prior turns can contain
   secrets the user sent before installing this extension, or approved deliberately. Run
   the detector over assembled context, not just over the draft.
3. Truncate by whole turns, never mid-message — half a message is worse context than
   one fewer message.
4. Never read another conversation. Scope is this chat only, matching the vault's
   conversation scoping and the user's expectation.

### Testing

- [x] Context contains no detected secret
- [x] Truncation falls on turn boundaries
- [x] Only the current conversation is read

### Implementation Notes

`lib/clarify/context.ts` — still pure. The adapter reads the DOM; this takes
turns as data and returns redacted text.

- **Redaction reuses `prepareForModel` from `refine/guard.ts`** rather than
  reimplementing it, so context and drafts travel the same audited path. It runs
  in **one pass over the joined text**, not per turn: per-turn passes would mint
  `[REDACTED_..._1]` twice for two different keys and the model would read them
  as the same value. Asserted.
- **Assistant turns are redacted too.** A key the assistant echoed back is the
  same leak and the easier one to forget.
- `ContextTurn` is a structural subset of the adapter's `ChatMessage`, so
  `getMessages()` output feeds in directly. A compile-time assertion in the test
  file pins this — it is what lets the module stay in the DOM-free test project.
- Included turns carry `index`/`id` and **no text**. Task 3 shows provenance by
  pointing at the message already on the page, which is better UX than
  re-rendering it and keeps one fewer copy of the conversation in memory.
- `isContextFor()` guards SPA route changes, which swap conversations without
  unloading the content script.

`CONTEXT_TOKEN_BUDGET = 1000` and `MAX_CONTEXT_TURNS = 12` are reservations, not
measurements — the model layer does the authoritative length check and returns
`too-long` as a value. `estimateTokens` is chars/4 and is never shown to the user.

---

## Task 3: Interpretation and Confirmation (CRITICAL)

**Version:** 0.4.0.3

### Description

Produce one concrete reading and ask the user whether it is right.

### Implementation Steps

1. Model returns a rewritten prompt with references resolved.
2. **Present it as a question, not a replacement**: "Do you mean: …?" with Yes, Edit,
   No. The original concept was explicit about this and it is the right call — an
   automatic rewrite of what someone meant is a much worse failure than a redaction
   error, because it is invisible.
3. Show *what* it resolved to, tied to the turn it came from, so a wrong guess is
   obvious rather than plausible.
4. "No" sends the original untouched and does not ask again for that draft.

### Testing

- [x] Nothing is substituted without explicit confirmation
- [x] The source turn for each resolution is shown
- [x] Declining sends the original exactly

### Implementation Notes

`lib/clarify/prompt.ts`, `grounding.ts`, `interpret.ts`, plus
`components/clarify-store.ts` and `ClarifyQuestion.tsx`.

**Grounding is this feature's executable bar**, and it is stricter than
refinement's. Refinement may add nothing; clarification *must* add something, so
the question is not whether words appeared but where they came from. Every phrase
the rewrite introduces must be findable in a turn the model was actually shown —
not merely somewhere in the conversation, but in the turns that survived the
budget. A phrase from a dropped turn is a coincidence, and treating it as grounded
would launder a fabrication. There is no partial success: one untraceable phrase
refuses the whole interpretation, because the user is being asked a yes/no
question and a question containing a fabrication is a trap.

That is what makes "show the source turn" a guarantee rather than a feature — a
resolution that cannot name its turn is never displayed.

**Measurement corrected the design twice**, both caught by tests rather than
reasoning:

1. `intentRetention` counted the reference words themselves as lost meaning.
   "Add this over there" → "add the login form to the settings page" scored 0.5
   and was refused, when it is the feature working perfectly. The baseline is now
   the draft *with its references cut out*.
2. That fix only worked once the locative span was widened to include its
   preposition — "over there", not "there". The span is both what the user is
   shown and what is excluded from the baseline, and half a phrase broke both.

**Reuse:** `prepareForModel`, `checkResponse`, `restore`, `cleanResponse`,
`hasPreamble`, `intentRetention`, and `PLACEHOLDER_RULE` all come from the
refinement pipeline, so both features travel one audited path. `MIN_RETENTION` is
0.7 against refinement's 0.25 — opposite reasons: refinement is licensed to throw
wording away, clarification is instructed to change nothing but the references.

**The question is not a modal**, unlike the approval modal and the refinement
review. Those interrupt because something is at stake. This one is unsolicited:
`role="region"`, no focus trap, no backdrop, no Escape handler, nothing blocked.
Every failure path is silent — no error, nothing to dismiss.

Quoted turn excerpts are run through the detector before display. The text is
already on screen, but it lands in our own DOM, and this product should not make
an exception for its own UI.

**Not wired into the content script yet.** When to offer, the rate limit, and
default-off are Task 4, which is where that belongs — the store and question are
complete and tested, but nothing mounts them.

---

## Task 4: Restraint Tuning (HIGH)

**Version:** 0.4.0.4

### Description

The failure mode for this feature is not being wrong — it is being *frequent*.

### Implementation Steps

1. Only offer when confidence is high. An uncertain interpretation shown to the user is
   a question they now have to think about, which is worse than the ambiguity they were
   comfortable with.
2. Never interrupt: this is offered alongside the composer, never as a modal, and never
   blocks sending.
3. Rate-limit per conversation. Twice in a row without being accepted, stop offering.
4. Off by default until beta feedback says otherwise — the noisiest new feature should
   not be the first thing a new user meets.

### Testing

- [x] Never blocks or delays sending
- [x] Stops offering after repeated declines
- [x] Default-off is asserted in `defaults.ts`

### Success Criteria

- [x] A user who ignores this feature entirely notices no cost

### Implementation Notes

Four mechanisms, one per implementation step.

**1. Confidence — all of it or none of it.** `interpret` now returns `partial`
when any flagged reference survives into the rewrite. "Add the login form over
there" is a *worse* thing to show someone than the draft they wrote: they were
comfortable with the ambiguity, and now they must evaluate a sentence that
resolved one half of it. The model is instructed to leave unclear references
alone, so this firing usually means it obeyed and there was not enough to go on.

**2. Never interrupts.** Wired to `adapter.onInput` with a 1200 ms idle debounce
— never to submit — and called as `void`, so nothing can await it. Asserted
structurally in `test/clarify-restraint.test.ts`: `lib/interception/` may not
mention clarify at all, `consider()` has exactly one call site and it is inside
the input watcher, and the interceptor is not passed the store. The guarantee is
that this code *cannot* delay a send, not that it currently does not.

**3. Rate limit.** Two unaccepted offers per conversation, then silence.
**Counted when an offer is shown, not when it is refused** — someone quietly
ignoring the panel is telling us the same thing as someone clicking No, and
counting only the clicks would let it keep interrupting. Checked before any work,
so a rate-limited conversation costs not even a model call. One acceptance
resets the budget.

**4. Off by default.** `clarifyEnabled: false`. Purely additive, so **no schema
bump** — this follows the precedent `refineStyle` set, and `migrate.ts` documents
why. Tests cover the migration path an existing user takes, plus the
string-`"false"` coercion trap. Exposed in the options page; the setting is read
fresh on every input so turning it on takes effect without a reload.

**Scope note:** the rate limit lives in the store, so it resets when the content
script reloads. Per-conversation persistence would mean writing user behaviour to
storage, which is a bigger decision than this milestone should make quietly.

---

**End of Milestone 0.4.0.0 Specification**
