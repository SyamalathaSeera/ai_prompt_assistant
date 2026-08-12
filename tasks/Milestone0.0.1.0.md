# Milestone 0.0.1.0 - Project Setup and Scaffolding

**Version:** 0.0.1.0
**Date Created:** 2026-08-12
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** Project kickoff conversation, 2026-08-12

Stand up a WXT + React + TypeScript MV3 extension that loads unpacked in Chrome and
injects a working content script into ChatGPT. No product logic — this milestone exists
to produce a clean, verified baseline.

---

## Version Information

**Current Version (at milestone start):**

- **ai_prompt_assistant:** `0.0.0.0` (greenfield, no package.json yet)

**Target Version (after milestone completion):**

- **ai_prompt_assistant:** `0.0.1.5`

**Task-Level Versioning:**

- Task 0 complete: 0.0.1.0
- Task 1 complete: 0.0.1.1
- Task 2 complete: 0.0.1.2
- Task 3 complete: 0.0.1.3
- Task 4 complete: 0.0.1.4
- Task 5 complete: 0.0.1.5

**Git Branch:**

- **ai_prompt_assistant:** `syamalatha-081226-0.0.1.0-ext`

---

## Progress Summary

**Completion:** 0 of 6 tasks complete (0%)

| Task                                      | Priority | Status  | Version   | Verified |
| ----------------------------------------- | -------- | ------- | --------- | -------- |
| Task 0: Milestone Initialization          | SETUP    | Pending | 0.0.1.0   | -        |
| Task 1: Initialize WXT project            | HIGH     | Pending | 0.0.1.1   | -        |
| Task 2: Tailwind + Vitest                 | HIGH     | Pending | 0.0.1.2   | -        |
| Task 3: Lint, format, tsconfig strict     | MEDIUM   | Pending | 0.0.1.3   | -        |
| Task 4: Manifest + module skeleton        | HIGH     | Pending | 0.0.1.4   | -        |
| Task 5: Verify unpacked load on ChatGPT   | CRITICAL | Pending | 0.0.1.5   | -        |

---

## Overview

**Objective:** A repo that builds, lints, tests, and loads in Chrome with a content
script confirmed running on chatgpt.com.

**Scope:**
- WXT + React + TypeScript project initialized
- Tailwind and Vitest configured
- Strict TypeScript, ESLint, Prettier
- Manifest permissions defined per ARCHITECTURE.md (single host at install)
- Empty but typed module skeleton for `detector/`, `adapters/`, `vault/`, `policy/`
- Verified unpacked load with a console-confirmed content script injection

**Explicitly NOT in scope:** any detection logic, any UI, any interception. Those are
0.0.2.0 through 0.0.4.0.

**Estimated Effort:** 1.5–2.5 hours
**Actual Effort:** 

**Dependencies:** None. This is the first milestone.

---

## Git Workflow Policy

**CRITICAL: Claude Code must NOT commit or push code to GitHub.**

Claude writes files, runs `tsc`, runs tests, and creates branches. The developer
reviews in GitHub Desktop, commits, pushes, and merges.

**The ONLY Git Exception:** branch creation for milestones.

**Git identity:** this is a personal project. The stored `git:https://github.com`
credential (previously the work account `sseera-pixel`) was deleted on 2026-08-12, so
Git Credential Manager will prompt on the first push — sign in as `SyamalathaSeera`.
See Task 0 for the remote URL form that keeps work and personal credentials separate.

---

## Task 0: Milestone Initialization (SETUP)

**Purpose:** Initialize the repository and create the feature branch
**Estimated Time:** 10-15 minutes
**Status:** Pending

> This milestone differs from the template: the repo does not exist yet, so there is no
> `main` to pull and no package.json to read. Subsequent milestones follow the standard
> Task 0.

### Step 0.1: Initialize the repository

```bash
cd /c/Users/Syamalatha/Desktop/ai_prompt_assistant
git init -b main
git personal            # sets SyamalathaSeera / syamalathaseera@gmail.com
git config user.email   # verify it resolved to the personal address
```

### Step 0.2: Add the remote (developer action)

Create the GitHub repository under the **personal** account, then add the remote using
the **username-in-URL form**:

```bash
git remote add origin https://SyamalathaSeera@github.com/SyamalathaSeera/ai_prompt_assistant.git
```

The `SyamalathaSeera@` prefix is not cosmetic. Git Credential Manager keys credentials
by username when one is present; without it, GCM stores a single credential for all of
github.com and work repos overwrite it on their next push.

**Credential state:** the old `git:https://github.com` entry (work account
`sseera-pixel`) was deleted on 2026-08-12. There is currently no stored git credential
for github.com.

### Step 0.3: Create the feature branch

```bash
git checkout -b syamalatha-081226-0.0.1.0-ext
```

Push once there is an initial commit.

> ⚠️ **Run the first push yourself, not through Claude.** GCM opens an interactive
> sign-in window that will hang a tool-driven command. Sign in as `SyamalathaSeera`.

### Step 0.4: Verify the credential landed correctly

After the first successful push:

```bash
cmdkey /list | findstr /C:"git:https://github.com" /C:"User:"
```

Expect `SyamalathaSeera`. If it shows `sseera-pixel`, the wrong account was used —
delete the entry and retry:

```bash
cmdkey /delete:LegacyGeneric:target=git:https://github.com
```

### Step 0.5: Update Milestone Header

Record Date Started and confirmed version.

### Success Criteria

- Repo initialized on `main`, personal git identity confirmed via `git config user.email`
- Remote uses the `https://SyamalathaSeera@github.com/...` form
- First push authenticated as `SyamalathaSeera`, verified in Credential Manager
- Feature branch `syamalatha-081226-0.0.1.0-ext` created
- Date Started recorded

---

## Task 1: Initialize WXT Project (HIGH)

**Estimated Time:** 20-30 minutes
**Status:** Pending
**Version:** 0.0.1.1
**Dependencies:** Task 0

### Description

Scaffold the WXT project with the React + TypeScript template. WXT generates the MV3
manifest from `wxt.config.ts`, so the manifest is not hand-authored.

### Implementation Steps

1. Scaffold into the existing directory (it already contains the management docs, so
   scaffold in place rather than into a new subfolder):
   ```bash
   npx wxt@latest init . --template react-ts
   ```
2. Set `"version": "0.0.1.0"` in `package.json`. WXT derives the manifest version from
   this; note MV3 manifest versions allow up to four dot-separated integers, which
   matches the project's MAJOR.MINOR.PATCH.BUILD scheme.
3. `npm install`
4. Confirm `npm run dev` starts and `.output/chrome-mv3-dev/` is produced.

### Affected Files

- `package.json`, `wxt.config.ts`, `tsconfig.json`
- `entrypoints/` (template default contents)

### Testing

- [ ] `npm run dev` starts without error
- [ ] `.output/chrome-mv3-dev/manifest.json` exists and reports version `0.0.1.0`
- [ ] `npm run build` completes

### Success Criteria

- WXT project initialized in place without clobbering CLAUDE.md, ARCHITECTURE.md, PRD.md, TASKS.md, `tasks/`, `bugs/`, `screenshots/`
- Version reads 0.0.1.0

> ⚠️ Verify the management docs still exist after scaffolding. If `wxt init` refuses a
> non-empty directory, scaffold to a temp folder and copy the generated files in.

---

## Task 2: Tailwind + Vitest (HIGH)

**Estimated Time:** 25-35 minutes
**Status:** Pending
**Version:** 0.0.1.2
**Dependencies:** Task 1

### Description

Add styling and the test runner. Vitest matters more than it looks: the detector corpus
suite in 0.0.2.0 is the project's main quality gate, so the runner must be trustworthy
from the start.

### Implementation Steps

1. Install and configure Tailwind for the extension's React entrypoints.
2. Install Vitest. Configure `vitest.config.ts` with a `node` environment for
   `lib/**` (the detector must be testable with no DOM) and `jsdom` only where
   component tests need it.
3. Add scripts: `"test"`, `"test:watch"`, `"typecheck": "tsc --noEmit"`.
4. Write one trivial passing test to prove the harness works.

### Testing

- [ ] `npm run test` passes
- [ ] `npm run typecheck` passes
- [ ] Tailwind classes render in the popup

### Success Criteria

- Tests run in a Node environment with no DOM available, confirming detector purity is enforceable
- Tailwind builds into the popup bundle

---

## Task 3: Lint, Format, Strict TypeScript (MEDIUM)

**Estimated Time:** 20-30 minutes
**Status:** Pending
**Version:** 0.0.1.3
**Dependencies:** Task 2

### Description

Set up the guardrails while the codebase is one file, not fifty.

### Implementation Steps

1. Enable `strict: true` plus `noUncheckedIndexedAccess` in `tsconfig.json`.
2. Add path aliases: `@/lib/*`, `@/components/*`.
3. ESLint + Prettier with a TypeScript config.
4. Add a lint rule (or a documented convention plus a test) that forbids `lib/detector/**`
   from importing `chrome.*`, DOM globals, or `lib/adapters/**` — ADR-004 is only real if
   something enforces it.
5. `.gitignore`: `node_modules/`, `.output/`, `.wxt/`, `*.zip`, `.env*`.

### Testing

- [ ] `npm run lint` passes clean
- [ ] `npm run typecheck` passes with strict on
- [ ] A deliberate `import { storage } from 'wxt/storage'` inside `lib/detector/` fails lint, then remove it

### Success Criteria

- Strict mode on, zero lint errors, detector boundary mechanically enforced

---

## Task 4: Manifest Config + Module Skeleton (HIGH)

**Estimated Time:** 30-40 minutes
**Status:** Pending
**Version:** 0.0.1.4
**Dependencies:** Task 3

### Description

Define permissions and create the empty, typed module structure from ARCHITECTURE.md so
later milestones have somewhere to land.

### Implementation Steps

1. In `wxt.config.ts` set manifest fields:
   - `permissions: ['storage']`
   - `host_permissions: ['https://chatgpt.com/*', 'https://chat.openai.com/*']`
   - `optional_host_permissions: ['https://claude.ai/*', 'https://gemini.google.com/*']`
   - No `activeTab`, no `tabs`, no `scripting` unless a later task proves it necessary
2. Create the skeleton with types only, no implementations:
   ```
   lib/detector/{types.ts,engine.ts,validators.ts,rules/}
   lib/adapters/{types.ts,registry.ts,chatgpt.ts}
   lib/vault/index.ts
   lib/policy/{schema.ts,defaults.ts}
   lib/storage/index.ts
   test/corpus/
   ```
3. Define `Finding`, `SiteAdapter`, and `Settings` interfaces exactly as specified in
   ARCHITECTURE.md.
4. Point `entrypoints/content.ts` at the ChatGPT host with `matches` from the adapter.

### Affected Files

- `wxt.config.ts`, `entrypoints/content.ts`, all of `lib/`

### Testing

- [ ] `npm run typecheck` passes with the new modules
- [ ] Built `manifest.json` shows exactly one host permission and `storage`

### Success Criteria

- Install-time permission ask is a single host, per PRD constraint
- Interfaces match ARCHITECTURE.md; no implementation logic written yet

---

## Task 5: Verify Unpacked Load on ChatGPT (CRITICAL)

**Estimated Time:** 20-30 minutes
**Status:** Pending
**Version:** 0.0.1.5
**Dependencies:** Task 4

### Description

Prove the whole loop end to end. This task is what makes the milestone real — a build
that compiles but does not inject is worth nothing.

### Implementation Steps

1. In `entrypoints/content.ts`, log a versioned marker on injection:
   `console.log('[APA] content script active', __APP_VERSION__)`
2. `npm run dev`
3. `chrome://extensions` → Developer mode → Load unpacked → `.output/chrome-mv3-dev`
4. Open `https://chatgpt.com`, open DevTools, confirm the marker appears.
5. Confirm the popup opens and renders Tailwind styles.
6. Edit the marker string and confirm HMR reloads the content script without a manual
   extension reload.

### Testing

- [ ] Marker logs on chatgpt.com
- [ ] Marker does **not** log on an unrelated site (e.g. example.com)
- [ ] Popup renders
- [ ] HMR updates the content script
- [ ] DevTools Network tab shows **zero** requests originating from the extension

### Success Criteria

- Content script confirmed running on the target host only
- Zero network requests — the ADR-001 guarantee is verified from day one
- Dev loop (edit → see change) is under a few seconds

### Architectural Guardrails

- [ ] No `fetch()` anywhere in the codebase
- [ ] `lib/detector/` imports nothing from `chrome.*`, DOM, or `adapters/`
- [ ] Nothing logged beyond the version marker
- [ ] Host chat fully usable with the extension loaded

---

## Session Notes

_(Record decisions, dead ends, and anything a future session needs. Implementation
detail lives here, not in CLAUDE.md.)_

---

**End of Milestone 0.0.1.0 Specification**
