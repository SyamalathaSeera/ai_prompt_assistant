# Milestone 0.4.0.0 - Clarify With Context

**Version:** 0.4.0.0
**Date Created:** 2026-08-13
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** Original product concept, "Feature 2: Clarify With Context"

Resolve vague references — "add this over there", "make it like before" — against the
conversation already on screen, and ask the user to confirm the interpretation before
sending.

---

## Version Information

**Current Version (at milestone start):** `0.3.0.5`
**Target Version:** `0.4.0.4`
**Git Branch:** `syamalatha-MMDDYY-0.4.0.0-ext`

---

## Progress Summary

**Completion:** 0 of 5 tasks complete (0%)

| Task                                  | Priority | Status  | Version | Verified |
| ------------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization      | SETUP    | Pending | 0.4.0.0 | -        |
| Task 1: Vague-reference detection     | HIGH     | Pending | 0.4.0.1 | -        |
| Task 2: Context assembly from the chat| CRITICAL | Pending | 0.4.0.2 | -        |
| Task 3: Interpretation and confirmation| CRITICAL| Pending | 0.4.0.3 | -        |
| Task 4: Restraint tuning              | HIGH     | Pending | 0.4.0.4 | -        |

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

- [ ] Fires on "add this over there and make it cleaner"
- [ ] Silent on a fresh chat with no history
- [ ] Silent on a specific, self-contained prompt

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

- [ ] Context contains no detected secret
- [ ] Truncation falls on turn boundaries
- [ ] Only the current conversation is read

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

- [ ] Nothing is substituted without explicit confirmation
- [ ] The source turn for each resolution is shown
- [ ] Declining sends the original exactly

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

- [ ] Never blocks or delays sending
- [ ] Stops offering after repeated declines
- [ ] Default-off is asserted in `defaults.ts`

### Success Criteria

- A user who ignores this feature entirely notices no cost

---

**End of Milestone 0.4.0.0 Specification**
