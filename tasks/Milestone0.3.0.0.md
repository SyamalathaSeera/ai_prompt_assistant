# Milestone 0.3.0.0 - Prompt Refinement

**Version:** 0.3.0.0
**Date Created:** 2026-08-13
**Date Started:** 2026-08-13
**Date Completed:** 2026-08-13
**Status:** Complete
**Based on:** Original product concept, "Feature 1: Refine Prompt"

Rewrite a rough prompt into a clearer one, on device, with the user approving every
change.

---

## Version Information

**Current Version (at milestone start):** `0.2.0.5` (confirmed 2026-08-13)
**Target Version:** `0.3.0.5`
**Git Branch:** `syamalatha-081326-0.3.0.0-ext` (created from `main` @ `220ec04`)

---

## Progress Summary

**Completion:** 6 of 6 tasks complete (100%)

| Task                                 | Priority | Status  | Version | Verified |
| ------------------------------------ | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization     | SETUP    | Complete | 0.3.0.0 | branch ✓ |
| Task 1: Refinement prompt + styles   | CRITICAL | Complete | 0.3.0.1 | 815 tests ✓ |
| Task 2: Redaction ordering guarantee  | CRITICAL | Complete | 0.3.0.2 | 815 tests ✓ |
| Task 3: Invocation surface            | HIGH     | Complete | 0.3.0.3 | 883 tests ✓ |
| Task 4: Review and accept UI          | HIGH     | Complete | 0.3.0.4 | 883 tests ✓ |
| Task 5: Quality evaluation            | HIGH     | Complete | 0.3.0.5 | 971 tests ✓ |

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

- [x] Intent preserved across a fixture set of rough prompts _(Task 5 corpus)_
- [x] No preamble survives into the suggestion
- [x] No fabricated specifics on vague input _(mechanically detectable ones; see Task 5)_

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

- [x] Refinement input never contains a detected secret
- [x] A response with altered, dropped, or invented placeholder is rejected
- [x] Refined output is re-scanned before display
- [x] `npm run typecheck` and `npm run lint` pass; three consecutive clean runs

### Success Criteria

- [x] No code path sends unredacted text to the model

### Outcome for Tasks 1–2 (2026-08-13)

**815 tests** (was 774); 41 for refinement.

**The instruction is the product.** `prompt.ts` states preserving intent above every
other rule, because a refinement that changes what the user meant is worse than none: they
will not re-read closely enough to catch it, they will send it, and they will blame the
model for answering the wrong question. Three prohibitions are stated explicitly because
they are what actually goes wrong — no preamble ("Here's an improved version:" would be
sent to the chat as part of the prompt), no invented specifics (a confident fabrication is
harder to spot than a vague original), and no answering the prompt instead of rewriting it.

**Styles are distinct instructions, not tone adjectives.** "Make it professional" produces
padding; saying what to do with the text produces genuinely different output. A test
asserts no two styles share an instruction, since identical guidance would mean there is
no reason to offer both.

**Responses are cleaned as well as instructed.** Instructions reduce preamble and fences;
they do not eliminate them. The output goes straight into someone's message box, so
`cleanResponse` strips wrappers the model adds anyway — while leaving legitimate internal
quotes alone, which a naive strip would eat.

**The ordering guarantee is enforced at three points**, not just documented:

| Point | Guard |
|---|---|
| Before the call | `prepareForModel` redacts, re-running the full detector rather than trusting a possibly stale finding set |
| After the call | placeholders must survive **exactly** — altered, dropped, or invented all reject |
| After the call | output is re-scanned, so a secret the model reformatted into a detectable shape is caught |

Rejecting rather than repairing is deliberate: a refinement is a convenience, and no
convenience is worth misrepresenting what left the machine.

**A failing test settled a design question that would otherwise have been decided by
accident.** Refinement honours the user's `disabledRuleIds`, so it uses the *same* rule
set as sending. Being more conservative would be incoherent — someone willing to send an
internal hostname to ChatGPT is certainly willing to have it processed on their own
machine — and it would create a confusing asymmetry: "why was my IP hidden from the
improver but not from the chat?" Both directions are now pinned by tests.

**Restoration happens locally.** The suggestion is shown against the original draft with
real values back in place, because a diff full of `[REDACTED_AWS_KEY_1]` would obscure
what actually changed. Those values were never sent and never leave the machine.

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

- [x] Never fires without explicit invocation
- [x] Hidden when the model is unavailable
- [x] Does not overlap the risk badge at common window sizes

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

- [x] Escape discards and restores the original exactly
- [x] Accept then undo returns the original text
- [x] Fully keyboard operable
- [x] `npm run typecheck` and `npm run lint` pass; three consecutive clean runs

### Outcome for Tasks 3–4 (2026-08-13)

**883 tests** (was 815); 68 for the refinement surfaces.

**Invocation is explicit in both senses.** A button beside the composer, and a browser
command bound to `Alt+Shift+I`. The shortcut is declared in the manifest rather than
implemented as a `keydown` listener in the content script, which buys three things a page
listener could not: the user can rebind it at `chrome://extensions/shortcuts`, Chrome
refuses a binding that collides with its own, and it cannot fire while the user is typing
in some other application. The command is delivered to the background worker, which
forwards a bare `{ type: 'apa:refine' }` to the active tab — **no prompt text travels
through the worker**, because the content script reads the composer itself. Pressing the
shortcut on a tab with no content script does nothing at all, silently, which is the
common case for a global shortcut.

**Hidden, not disabled, when there is no model.** `showModelFeatures: false` removes the
button entirely; a disabled control that can never be enabled is an unanswered question in
the interface. The absence is accounted for in options instead, in plain language, along
with the fact that redaction is unaffected.

**A dead end was found and closed.** `run()` deliberately never triggers the model
download — hundreds of megabytes is not something a keystroke should start on a metered
connection — but nothing else offered to either. On a machine where the model was
*downloadable but not downloaded*, the button would have appeared and failed forever with
"needs to be downloaded first". Options now owns that one-time download, with progress,
started from a real click so Chrome's user-activation requirement is met.

**Collision with the risk badge is asserted, not eyeballed.** Both surfaces sit above the
composer; the badge reserves 160px of the right edge, so the button takes the left. A test
walks five composer widths down to 420px and asserts the horizontal gap never falls below
the button group's own width. Two surfaces that "looked fine on my monitor" is exactly the
class of bug this project has already paid for once.

**Only one thing at a time may ask for a decision.** When a submission is held, the badge
and the refine button hide and the approval modal wins over a pending review — it concerns
a prompt already on its way out, and a rewrite suggestion can wait. Two dialogs about the
same prompt is a choice nobody can make.

**The diff had to be provably lossless.** The review shows a word-level LCS diff, and the
property tested is reconstruction: filtering out the additions rebuilds the original
exactly, filtering out the removals rebuilds the suggestion exactly. A diff that quietly
dropped a word would misrepresent what the user is agreeing to. Above 2000 tokens it falls
back to "everything changed" rather than paying for a quadratic table — still true, just
less useful.

**Accepting writes to the composer and never submits**, and stays undoable: the buffer is
captured from the composer at the moment of accept rather than from our own state, so undo
restores what was actually there. Escape discards, matching the approval modal.

**Two bugs found by writing the tests.** The refinement style reset to the default on every
accept or dismiss, so the remembered preference would have appeared to save and then not.
And the superseded-request test hung rather than failed until the mock model was made to
reject on abort the way a real one does — a mock that ignores its signal proves nothing
about cancellation.

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

- [x] Fixture suite runs in CI
- [x] Latency budget enforced
- [x] Refusal path produces a clear message, never a broken UI
- [x] `npm run typecheck` and `npm run lint` pass; three consecutive clean runs

### Outcome for Task 5 (2026-08-13)

**957 tests** (was 883); 74 for the quality gate.

**The bar became executable.** "A refusal is better than a mediocre suggestion" was a
sentence in this file; it is now a step in the pipeline. `lib/refine/evaluate.ts` runs
after restoration and refuses a rewrite that broke one of the rules the instruction gave
it. Five checks, each earned by a specific failure the user would not catch themselves:

| Check | The failure it prevents |
|---|---|
| `preamble` | "Here's an improved version:" sent to the chat as if they typed it |
| `fabricated-specifics` | A file, version, or product name they never mentioned |
| `intent-lost` | The rewrite asks a different question |
| `constraints-dropped` | Every limit word gone, inverting the request |
| `too-long` / `too-short` | The model answered the prompt instead of rewriting it |

**What is measured is the gate, not the model.** Twenty graded suggestions — the kind an
on-device model plausibly returns, half of them wrong in a specific way — run through the
real pipeline, and the assertion is zero false accepts and zero false refusals. Prose
quality cannot be asserted, and a score for it would be a number that means nothing. Real
model output remains a beta question, exactly as the detector corpus is.

**The gate's limit is asserted, not assumed.** A model turning "why is it slow" into "why
is my database query slow" invents the whole subject in words indistinguishable from
ordinary rewriting. Each fixture therefore carries an `undetectable` list alongside
`mustNotInvent`, and a test asserts those *do* slip through. Claiming they were covered
would have been the more comfortable choice and the wrong one — it is precisely why the
user sees a diff before anything is sent.

**Thresholds went the other way from where they started.** The first draft refused four of
the nine good suggestions: a "shorter" rewrite that strips politeness legitimately keeps
under a third of the original's words. Intent retention dropped from 0.5 to 0.25, hedging
words moved into the stopword list, and the constraint check became "did every limit word
disappear" rather than "did each one survive" — because "does not use recursion" becoming
"no recursion" is a good rewrite, not a lost constraint. A gate calibrated against only
bad output would have shipped refusing the rewrites that did their job best.

**Refusal rate: 55% of the graded corpus** (11 of 20), which is a property of a corpus
built half from bad output, not a prediction. It is asserted to stay between 20% and 80%:
either extreme would mean the gate had stopped discriminating. Every refusal carries a
message a person can act on, and leaves the draft untouched.

**Our own overhead** — detect, redact, validate, restore, diff — is held under **150ms on
a 4KB draft** in CI, so a slow refinement is always the model's doing and never ours.

---

### The on-device run (2026-08-13)

The model was downloaded mid-task and **27 real refinements were measured**: 21 over the
fixture set at their declared styles, then 6 more on drafts written afterwards, so the
thresholds could not have been fitted to them. Recorded in
`test/refine-corpus/on-device-2026-08-13.json` and graded in CI by `on-device.test.ts`.

| | |
|---|---|
| Median | **5.7s** |
| 90th percentile | **10.1s** |
| Slowest (fixture set) | **10.6s** |
| Slowest observed | **50.4s** (confounded — the tooling lost its connection mid-call) |
| Accepted by the gate | 16 of 21, then **6 of 6** on the holdout |
| Fabrications found | **0 across all 27** |
| Placeholders damaged | **0** |

**Two things were wrong, and only measurement could have shown either.**

**The 8s budget was fiction.** It was chosen on the reasoning that nobody waits longer
than that — and five of twenty-one successful rewrites took longer, so a quarter of them
would have been killed and reported to the user as failures. `REFINE_TIMEOUT_MS` is now
20s. A timeout exists to stop a hung call, not to enforce an opinion about patience.

**The length floor refused the feature working.** Four of the five refusals in the first
batch were `too-short`, and every one was a rambling draft correctly compressed to the
request it contained: forty words of politeness became "Explain caching concepts at a high
level", a ratio of 0.16. The proportional floor is gone — what a rewrite *dropped* is
caught by intent retention and the constraint check, which look at what was lost rather
than at how much. Only an absolute floor remains, for output too short to carry a request
at all. After the change, the holdout refused nothing.

**A UX consequence fell out of the numbers.** At a median of 5.7s and a tail past 10s, a
button that sits disabled while it works is a control that ignores the user for ten
seconds with no way out but reloading the page. It now cancels on the second press.

**What the run does not show.** One machine, one day, one model version, 27 prompts. The
outputs are genuinely good — placeholders survived every time, and nothing was invented —
but a sample this size cannot establish a rate. That remains a beta question, and the
recording is kept so the next measurement has something to disagree with.

---

**End of Milestone 0.3.0.0 Specification**
