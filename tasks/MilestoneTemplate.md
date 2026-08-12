# Milestone [VERSION] - [Milestone Title]

**Version:** [VERSION] (starting version, from package.json PATCH +1, BUILD reset to 0)
**Date Created:** YYYY-MM-DD
**Date Started:** YYYY-MM-DD (when Task 0 begins)
**Date Completed:** YYYY-MM-DD (when all tasks complete)
**Status:** Planning | In Progress | Complete
**Based on:** [Reference document/issue/request]

[Brief 1-2 sentence description of what this milestone accomplishes]

---

## Version Information

**Current Version (at milestone start):**

- **ai_prompt_assistant:** `[Check package.json in Task 0]`

**Target Version (after milestone completion):**

- **ai_prompt_assistant:** `[VERSION].N` (where N = number of tasks)

**Task-Level Versioning:**
Each task completion increments the BUILD number (4th digit) by 1:

- Task 0 complete: [VERSION]
- Task 1 complete: [VERSION but BUILD +1]
- Task 2 complete: [VERSION but BUILD +2]
- etc.

**Git Branch:**

- **ai_prompt_assistant:** `syamalatha-MMDDYY-[VERSION]-ext`

---

## Progress Summary

**Completion:** X of Y tasks complete (Z%)

| Task                             | Priority | Status  | Version          | Verified |
| -------------------------------- | -------- | ------- | ---------------- | -------- |
| Task 0: Milestone Initialization | SETUP    | Pending | -                | -        |
| Task 1: [Task Name]              | HIGH     | Pending | [VERSION].1      | -        |
| Task 2: [Task Name]              | MEDIUM   | Pending | [VERSION].2      | -        |
| Task 3: [Task Name]              | LOW      | Pending | [VERSION].3      | -        |

**Status Legend:**

- Pending: not started
- In Progress: currently being worked on
- Complete: implementation finished
- Verified: confirmed working in a real browser session

---

## Overview

**Objective:** [What this milestone aims to achieve]

**Scope:**

- [Key deliverable 1]
- [Key deliverable 2]
- [Key deliverable 3]

**Estimated Effort:** X hours / Y days
**Actual Effort:** [Track actual time spent]

**Dependencies:**

- [Milestone or feature this depends on] (status)

---

## Git Workflow Policy

**CRITICAL: Claude Code must NOT commit or push code to GitHub.**

**Claude Code Responsibilities:**

- Write and modify code files
- Run TypeScript compilation to verify changes
- Run tests if requested
- Prepare code for review
- Create feature branches ONLY (git checkout -b, git push -u origin)

**User Responsibilities:**

- Review code changes in GitHub Desktop
- Create commits with appropriate messages
- Push commits to feature branch
- Create pull requests, manage branches and merges
- Publish extension builds to the Chrome Web Store

**The ONLY Git Exception:**
Branch creation for milestones:

- `git checkout -b syamalatha-MMDDYY-[VERSION]-ext`
- `git push -u origin syamalatha-MMDDYY-[VERSION]-ext`

**Git identity reminder:** this is a personal project. Confirm `git config user.email`
resolves to the personal account before the first push of any milestone.

---

## Task 0: Milestone Initialization (SETUP)

**Purpose:** Initialize milestone by determining current version and creating the feature branch
**Estimated Time:** 5-10 minutes
**Status:** Pending

### Step 0.1: Determine Current Version

```bash
cd /c/Users/Syamalatha/Desktop/ai_prompt_assistant
git checkout main
git pull origin main
cat package.json | grep '"version"'
```

**Action:** Record current version from package.json.

**Update Milestone Document:**

- Current version: `[from package.json]`
- Starting milestone version: `[current PATCH +1, BUILD reset to 0]`
- Task versioning: each task adds +0.0.0.1

### Step 0.2: Create Feature Branch

**Branch Naming Format:** `syamalatha-MMDDYY-[VERSION]-ext`

```bash
cd /c/Users/Syamalatha/Desktop/ai_prompt_assistant
git checkout main
git pull origin main
git checkout -b syamalatha-MMDDYY-[VERSION]-ext
git push -u origin syamalatha-MMDDYY-[VERSION]-ext
```

### Step 0.3: Update Milestone Header

Update this document with confirmed version and Date Started.

### Success Criteria

- Current version recorded from package.json
- Feature branch created and pushed
- Milestone header updated with confirmed version
- Date Started recorded
- Ready to proceed with Task 1

---

## Task 1: [Task Name] (PRIORITY)

**Estimated Time:** X hours
**Actual Time:** [Fill in when complete]
**Status:** Pending
**Version:** [VERSION].1
**Dependencies:** Task 0

### Description

[Detailed description of what needs to be done and why]

### Affected Files

- `path/to/file1`
- `path/to/file2`

### Implementation Steps

1. [Step 1]
2. [Step 2]
3. [Step 3]

### Testing

- [ ] `npx tsc --noEmit` passes
- [ ] `npm run test` passes
- [ ] [Manual verification in a loaded unpacked extension]

### Success Criteria

- [Criterion 1]
- [Criterion 2]

### Architectural Guardrails

Every task in this project must preserve these. Re-check before marking complete:

- [ ] No `fetch()` / `XMLHttpRequest` / WebSocket added anywhere
- [ ] `lib/detector/` still imports nothing from `chrome.*`, the DOM, or `adapters/`
- [ ] No detected value is logged, persisted to `.local`, or written to `.sync`
- [ ] All injected UI is inside the shadow root
- [ ] Failure path leaves the host chat fully usable

---

## Task 2: [Task Name] (PRIORITY)

[Follow same structure as Task 1]

---

## Session Notes

[Implementation detail, decisions made, dead ends, and anything a future session needs
to know. This is the log — keep it here, not in CLAUDE.md.]

---

**End of Milestone [VERSION] Specification**
