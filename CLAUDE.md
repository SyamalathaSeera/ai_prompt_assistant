# CLAUDE.md: AI Prompt Assistant Development Guide

## Project Overview

AI Prompt Assistant is a Manifest V3 browser extension that scans what you are about
to send to an LLM chat interface, detects secrets and sensitive data in the draft,
and offers a redacted version before the prompt leaves your machine. When the model's
reply comes back containing a placeholder, the extension swaps the real value back in
locally, so redaction is lossless from the user's point of view.

The product is positioned as a **privacy / DLP tool**, not a prompt enhancer. Prompt
refinement is a deliberately secondary, later feature.

**Key Architecture**: Single-repo MV3 extension. WXT + React + TypeScript.
**Zero network requests in v1** — all detection runs locally in the content script.
No backend, no server, no telemetry.

**Repository Locations:**
- AI Prompt Assistant: `C:\Users\Syamalatha\Desktop\ai_prompt_assistant` ⭐ Management docs live here

**Deployment:**
- Local: `npm run dev` → load unpacked from `.output/chrome-mv3-dev`
- Production: Chrome Web Store (not yet submitted)

---

## Current Status

**Phase**: Milestone 0.1.0.0, Multi-Platform Adapters
**Last Updated**: 2026-08-13
**Version**: 0.0.6.4

### Completed Milestones
- **0.0.1.0** (2026-08-12): Project setup and scaffolding. WXT + React + TS + Tailwind
  + Vitest + ESLint. Verified live on chatgpt.com: content script injects on the target
  host only, and **zero of 386 network requests** originated from the extension — the
  ADR-001 baseline.

- **0.0.2.0** (2026-08-12): Detector engine + labeled corpus. 16 high-tier rules and 6
  low-tier PII rules, 212 tests. Quality gate live in CI: **precision 100%, recall 100%**
  against 10 positive and 24 negative documents, 0.4ms on 10KB against a 50ms budget.
  Treat 100% as provisional — the corpus is self-authored, and the number that matters
  comes from beta.

- **0.0.3.0** (2026-08-13): Site adapter + interception. 327 tests. ChatGPT selectors
  verified against the live DOM — which caught a 0×0 decoy textarea, a double-fire on
  send, and a self-interception loop that no jsdom test would have found. Submit holds,
  paste warns without blocking, live scan drives the risk level. Fail-open proven by
  fault injection at every stage.

- **0.0.4.0** (2026-08-13): Approval modal + risk badge. 460 tests. **The product loop is
  complete and dogfoodable** — typing a secret into ChatGPT holds the submission, shows
  what was found, and sends what the user approves. Switched React → Preact (ADR-006):
  build fell from 426 kB to ~104 kB. Contrast is asserted against the shipped stylesheet
  and caught a real AA failure on first run.

- **0.0.5.0** (2026-08-13): Vault + re-hydration. 533 tests. **Redaction is now
  lossless** — secrets are replaced on the way out and restored on the way back, never
  leaving the device. Session-only storage with sliding 4h expiry; hydration is
  display-only and refuses to enter form controls or the composer.

- **0.0.6.0** (2026-08-13): Settings, allowlist, popup, options. 620 tests. Real storage
  replaces the defaults stub; popup shows catch counts and a timed pause; options page
  describes every rule in plain language and offers a delete that really deletes.
  Schema now at v2 — the allowlist gained labels and dates, exercising the migration
  machinery for real.

### Active Milestone
- **Milestone 0.1.0.0**: Multi-platform adapters (Claude, Gemini)

### Planned Next
- **0.1.0.0**: Claude + Gemini adapters
- **0.2.0.0**: On-device model foundation (Chrome Prompt API)
- **0.3.0.0**: Prompt refinement
- **0.4.0.0**: Clarify with context
- **0.5.0.0**: Hardening, e2e, performance
- **0.6.0.0**: Onboarding
- **0.9.0.0** → **1.0.0.0**: Beta, then public launch

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension framework | WXT (MV3, Chrome + Firefox targets) |
| UI | Preact 10 + TypeScript (ADR-006) |
| Styling | Tailwind CSS (injected UI scoped via Shadow DOM) |
| Detection | Pure TypeScript, no DOM, no network |
| Storage | `chrome.storage.local` (settings) + `chrome.storage.session` (vault) |
| Testing | Vitest (unit + detector corpus) |
| Backend | None |
| Hosting | Chrome Web Store |

---

## Non-Negotiable Product Rules

These are architectural commitments, not preferences. Breaking any of them changes
what the product is.

1. **No network requests.** The install-time pitch is "nothing leaves your machine."
   One `fetch()` in the content script invalidates the entire positioning. Model work
   runs on-device via Chrome's Prompt API precisely so this survives — see ADR-007.
2. **The detector is pure.** `lib/detector/` takes a string and returns findings. No
   DOM access, no storage access, no I/O. This is what makes it testable.
3. **Never log or persist a detected secret value.** Log the rule id and character
   offsets only. This applies to console output during development too.
4. **All injected UI lives in a Shadow DOM.** Host pages reshuffle their CSS
   constantly, and our styles must never leak into theirs.
5. **Minimum permissions at install.** ChatGPT host only. Every other host goes
   through `optional_host_permissions` and is requested at the moment of use.
6. **The user always approves before a prompt is modified.** No silent rewrites.

---

## Workflow Rules

**Git Policy:**
- Claude does NOT run `git add`, `git commit`, `git push`, or create PRs
- Exception: creating feature branches **locally** (`git checkout -b`). Claude cannot
  push them — see the credential note below
- Developer handles all commits, pushes, and merges via GitHub Desktop
- **Push cadence:** developer pushes at milestone boundaries, not per task. Work is
  local-only until the milestone-end push

**Git Identity:**
- This is a **personal** project. Run `git personal` in the repo before the first
  commit to set `SyamalathaSeera / syamalathaseera@gmail.com`.
- **Credential state (as of 2026-08-12):** the stale legacy entry
  `git:https://github.com` (work account `sseera-pixel`) was deleted. The live
  credential is `GitHub - https://api.github.com/SyamalathaSeera`, created by GitHub
  Desktop when this repo was first published. `credential.helper = manager` is set at
  system level.
- **The remote uses the username-in-URL form**, which tells GCM which account this repo
  wants when work and personal accounts are both stored:
  ```
  https://SyamalathaSeera@github.com/SyamalathaSeera/ai_prompt_assistant.git
  ```
- **Claude cannot push.** GCM requires an interactive sign-in window and tool-driven
  commands run with prompts disabled, so any push Claude attempts fails with
  `could not read Username`. All pushes are developer actions — consistent with the git
  policy above.

**Branch Naming:**
- `syamalatha-MMDDYY-[VERSION]-ext`
- Example: `syamalatha-081226-0.0.1.0-ext`

**Version Bumping:**
- Each task completion: BUILD +1 (e.g. `0.0.1.0` -> `0.0.1.1`)
- Each new milestone: PATCH +1, BUILD resets to 0 (e.g. `0.0.1.N` -> `0.0.2.0`)

**Session Start:**
Run `/session-start ai_prompt_assistant` at the start of every terminal session.

**Milestone Workflow:**
- Task 0 of every milestone: check versions, create branches (with user approval)
- All detail, session notes, and implementation specifics go in milestone files
- This file stays concise. It is a reference, not a log

---

## Key Files

| File | Purpose |
|---|---|
| `CLAUDE.md` | This file. Session guide and workflow reference |
| `ARCHITECTURE.md` | Technical architecture, patterns, ADR log |
| `PRD.md` | Product requirements: vision, goals, users, MVP |
| `TASKS.md` | Milestone status dashboard |
| `./tasks/` | Detailed milestone files. All implementation detail lives here |
| `./bugs/` | Bug fix tracking files |
| `./screenshots/` | Bug fix screenshots |
