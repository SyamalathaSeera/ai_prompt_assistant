# Milestone 0.3.0.0 - Prompt Refinement

**Version:** 0.3.0.0
**Date Created:** 2026-08-13
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** Original product concept, "Feature 1: Refine Prompt"

Rewrite a rough prompt into a clearer one, on device, with the user approving every
change.

---

## Version Information

**Current Version (at milestone start):** `0.2.0.5`
**Target Version:** `0.3.0.5`
**Git Branch:** `syamalatha-MMDDYY-0.3.0.0-ext`

---

## Progress Summary

**Completion:** 0 of 6 tasks complete (0%)

| Task                                 | Priority | Status  | Version | Verified |
| ------------------------------------ | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization     | SETUP    | Pending | 0.3.0.0 | -        |
| Task 1: Refinement prompt + styles   | CRITICAL | Pending | 0.3.0.1 | -        |
| Task 2: Redaction ordering guarantee  | CRITICAL | Pending | 0.3.0.2 | -        |
| Task 3: Invocation surface            | HIGH     | Pending | 0.3.0.3 | -        |
| Task 4: Review and accept UI          | HIGH     | Pending | 0.3.0.4 | -        |
| Task 5: Quality evaluation            | HIGH     | Pending | 0.3.0.5 | -        |

---

## Overview

**Objective:** The user can turn "make this better" into a well-formed instruction
without leaving the composer, and can always see exactly what changed before it is sent.

**Estimated Effort:** 6–8 hours

**Dependencies:** 0.2.0.0

**The honest risk.** Prompt-enhancer extensions are a crowded category with weak
retention — that is why redaction leads this product and refinement follows. Built well
it is a real convenience; built carelessly it is the feature that makes the extension
feel like a gimmick. The bar is that a refusal to suggest is better than a mediocre
suggestion.

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch, Date Started.

---

## Task 1: Refinement Prompt and Styles (CRITICAL)

**Version:** 0.3.0.1

### Description

The system prompt is the product here. Everything else is plumbing.

### Implementation Steps

1. Write a system prompt that **preserves intent above all else**. A refinement that
   changes what the user meant is worse than none: they will not re-read closely enough
   to catch it, and will blame the model for the wrong answer.
2. Styles from the original concept: concise, detailed, technical, professional,
   beginner-friendly. Each a distinct instruction, not a tone adjective bolted on.
3. Output must be the rewritten prompt ONLY — no preamble, no explanation, no
   "Here's an improved version". Strip any that appears.
4. Never invent specifics. If the draft says "the login bug", the refinement must not
   name a file the user never mentioned.

### Testing

- [ ] Intent preserved across a fixture set of rough prompts
- [ ] No preamble survives into the suggestion
- [ ] No fabricated specifics on vague input

---

## Task 2: Redaction Ordering Guarantee (CRITICAL)

**Version:** 0.3.0.2

### Description

**Refinement must run on redacted text, never on the original.**

Even on-device this ordering matters: the redaction step is where the user decides what
their secret becomes, and a refinement pass that rewrites the raw draft could reproduce
or paraphrase a secret into text that is then approved without a second look. If a
future build ever gains a remote model, this ordering is the only thing standing between
a secret and an API.

### Implementation Steps

1. Detection runs first; refinement receives text with placeholders already substituted.
2. Placeholders are protected: the model must return them intact, and a response with a
   mangled placeholder is rejected rather than shown.
3. Re-scan the refined output before offering it — the model may reformat a secret we
   had not matched into one we now would.

### Testing

- [ ] Refinement input never contains a detected secret
- [ ] A response with altered placeholders is rejected
- [ ] Refined output is re-scanned before display

### Success Criteria

- No code path sends unredacted text to the model

---

## Task 3: Invocation Surface (HIGH)

**Version:** 0.3.0.3

### Description

How the user asks for a refinement.

### Implementation Steps

1. Explicit invocation only — a button near the composer, plus a keyboard shortcut.
   Refinement is not automatic: rewriting what someone typed without being asked is
   presumptuous, and unlike redaction there is no safety argument for it.
2. Style picker remembered across sessions.
3. Disabled with a reason when no model is available (0.2.0.4).
4. Must not collide with the risk badge's position.

### Testing

- [ ] Never fires without explicit invocation
- [ ] Hidden when the model is unavailable
- [ ] Does not overlap the risk badge at common window sizes

---

## Task 4: Review and Accept UI (HIGH)

**Version:** 0.3.0.4

### Description

Show the change, let the user take it, edit it, or discard it.

### Implementation Steps

1. Side-by-side or inline diff of original versus suggestion.
2. Accept, Edit, Discard. Discard is the default on Escape.
3. The original is never lost — accepting is undoable until the prompt is sent.
4. Reuses the shadow-root panel and focus-trap conventions from 0.0.4.0.

### Testing

- [ ] Escape discards and restores the original exactly
- [ ] Accept then undo returns the original text
- [ ] Fully keyboard operable

---

## Task 5: Quality Evaluation (HIGH)

**Version:** 0.3.0.5

### Description

The detector has a corpus and a numeric gate. Refinement needs its own bar, or "is it
any good" stays a matter of opinion.

### Implementation Steps

1. Build a fixture set of rough prompts with the intent of each recorded.
2. Assert mechanical properties rather than prose quality: intent-bearing nouns
   survive, no fabricated specifics, no preamble, output within a length band.
3. Measure latency on device and set a budget — a refinement that takes eight seconds
   will not be used twice.
4. Record a refusal rate: cases where the model returns something we reject.

### Testing

- [ ] Fixture suite runs in CI
- [ ] Latency budget enforced
- [ ] Refusal path produces a clear message, never a broken UI

---

**End of Milestone 0.3.0.0 Specification**
