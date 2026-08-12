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

**Phase**: Milestone 0.0.1.0, Project Initialization
**Last Updated**: 2026-08-12
**Version**: 0.0.0.0

### Completed Milestones
_(none yet)_

### Active Milestone
- **Milestone 0.0.1.0**: Project setup and scaffolding

### Planned Next
- **0.0.2.0**: Detector engine + labeled test corpus
- **0.0.3.0**: Site adapter + submit interception + approval modal
- **0.0.4.0**: Re-hydration, allowlist, options page
- **0.0.5.0**: Store readiness (onboarding, privacy policy, listing assets)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension framework | WXT (MV3, Chrome + Firefox targets) |
| UI | React 19 + TypeScript |
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

1. **No network requests in v1.** The install-time pitch is "nothing leaves your
   machine." One `fetch()` in the content script invalidates the entire positioning.
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
- Exception: creating feature branches only (`git checkout -b` + `git push -u origin`)
- Developer handles all commits and merges via GitHub Desktop

**Git Identity:**
- This is a **personal** project. Run `git personal` in the repo before the first
  commit to set `SyamalathaSeera / syamalathaseera@gmail.com`.
- **Credential state (as of 2026-08-12):** the stored `git:https://github.com`
  credential — which previously held the work account `sseera-pixel` — was deleted.
  Git Credential Manager (`credential.helper = manager`, set at system level) will
  prompt on the next push. Sign in as **SyamalathaSeera**.
- **Use the username-in-remote form** so the personal and work credentials coexist
  instead of overwriting each other:
  ```
  https://SyamalathaSeera@github.com/SyamalathaSeera/ai_prompt_assistant.git
  ```
  Without the username hint, GCM stores one credential for all of github.com, and the
  next push from a work repo (`thesus-bt`, `nurses-station-dev`, `thesushealth-web`)
  replaces it.

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
