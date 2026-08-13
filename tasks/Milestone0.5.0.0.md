# Milestone 0.5.0.0 - Hardening, Resilience, Performance

**Version:** 0.5.0.0
**Date Created:** 2026-08-12
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** PRD non-functional requirements

Turn a working extension into a production one. The failure mode this milestone exists to
prevent: ChatGPT ships a DOM change, the extension silently stops protecting people, and
nobody finds out for three weeks.

---

## Version Information

**Current Version (at milestone start):** `0.4.0.4`
**Target Version:** `0.2.0.5`
**Git Branch:** `syamalatha-MMDDYY-0.5.0.0-ext`

---

## Progress Summary

**Completion:** 0 of 6 tasks complete (0%)

| Task                                    | Priority | Status  | Version | Verified |
| --------------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization        | SETUP    | Pending | 0.5.0.0 | -        |
| Task 1: Adapter self-healing + health   | CRITICAL | Pending | 0.2.0.1 | -        |
| Task 2: Remote selector config (data)   | HIGH     | Pending | 0.2.0.2 | -        |
| Task 3: Error boundaries + fail-open    | CRITICAL | Pending | 0.2.0.3 | -        |
| Task 4: Performance budget              | HIGH     | Pending | 0.2.0.4 | -        |
| Task 5: E2E suite (Playwright)          | HIGH     | Pending | 0.2.0.5 | -        |

---

## Overview

**Objective:** The extension degrades visibly and safely, recovers from host changes
without a store update where possible, and never costs the user performance.

**Estimated Effort:** 6–8 hours

**Dependencies:** 0.1.0.0

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch `syamalatha-MMDDYY-0.5.0.0-ext`, Date Started.

---

## Task 1: Adapter Self-Healing and Health Reporting (CRITICAL)

**Version:** 0.2.0.1

### Description

Silent failure is the worst outcome for a security tool — the user believes they are
protected when they are not.

### Implementation Steps

1. Health check on injection: can the composer be resolved? Do submit listeners attach?
2. On failure, retry with backoff across the fallback chain before giving up.
3. On persistent failure, **tell the user** — badge state plus popup message: "Protection
   unavailable on this page." Never fail silently.
4. Heuristic composer discovery as a last resort: find the focused `contenteditable` or
   `textarea` nearest a submit control.
5. Record health status locally for the user to see. No transmission.

### Testing

- [ ] Forcing all primary selectors to fail triggers the heuristic path
- [ ] Total failure surfaces a visible "protection unavailable" state
- [ ] Recovery works when the composer appears late

### Success Criteria

- A user can always tell whether they are currently protected

---

## Task 2: Remote Selector Config, Data Only (HIGH)

**Version:** 0.2.0.2

### Description

Selector breakage should not require a store review cycle. MV3 forbids remotely loaded
**code**; fetched **data** is permitted.

> ⚠️ This is the one place the "no network requests" rule is relaxed. It must be an
> explicit, documented, user-visible exception — opt-out in settings, config data only,
> never prompt content, never on the prompt path. Re-read the current Chrome Web Store
> policy before implementing, and record the decision as an ADR.

### Implementation Steps

1. Fetch a signed JSON selector map from a static host, on a slow schedule, from the
   background worker only — never the content script, never during a scan.
2. Validate against a strict schema; reject anything unexpected. Selectors are strings
   used with `querySelector`, never evaluated as code.
3. Bundled selectors remain the fallback; remote config only overrides.
4. Setting to disable remote config entirely, and a clear statement in the privacy
   section describing exactly what this request contains (nothing user-specific).
5. Add ADR-006 recording this exception and its justification.

### Testing

- [ ] Malformed or unsigned config is rejected, bundled selectors used
- [ ] Disabling the setting stops all network activity
- [ ] No user data is included in the request
- [ ] Prompt path still makes zero network requests

---

## Task 3: Error Boundaries and Fail-Open Verification (CRITICAL)

**Version:** 0.2.0.3

### Implementation Steps

1. React error boundary around all injected UI — a UI crash must not block submission.
2. Wrap every host-page interaction; on throw, release the pending submission.
3. Fault-injection test mode that deliberately throws at each stage of the pipeline.
4. Local-only error log (message and stack, never prompt content) viewable in options,
   so bug reports can be filed without the user pasting sensitive material.

### Testing

- [ ] Injected fault at each pipeline stage still submits the prompt
- [ ] UI crash does not block the composer
- [ ] Error log contains no prompt content

### Success Criteria

- Fail-open proven by systematic fault injection, not assumed

---

## Task 4: Performance Budget (HIGH)

**Version:** 0.2.0.4

### Implementation Steps

1. Benchmarks: detection on 1KB / 10KB / 100KB / 1MB inputs.
2. Enforce the PRD budget (< 50ms at 10KB) as a failing test.
3. Move large scans off the main thread if the budget cannot be met inline.
4. Cap and chunk pathological inputs so a huge paste never freezes the tab.
5. Measure content-script bundle size and injection cost; set a size budget.

### Testing

- [ ] Budget test fails when a slow rule is introduced
- [ ] 1MB paste does not freeze the tab
- [ ] No measurable typing lag on a long draft

---

## Task 5: E2E Suite (HIGH)

**Version:** 0.2.0.5

### Implementation Steps

1. Playwright with the extension loaded, driving a mocked chat page that mirrors each
   platform's DOM fixtures.
2. Cover the full journeys: clean submit, caught submit, send redacted, send original,
   allowlist, re-hydration, adapter failure.
3. Run against saved DOM fixtures in CI; keep an optional live smoke test that is
   allowed to fail loudly when a platform changes.

### Testing

- [ ] All journeys pass headless in CI
- [ ] Suite catches a deliberately broken adapter

### Architectural Guardrails

- [ ] Detector still pure
- [ ] Only Task 2's config fetch exists; prompt path remains network-free
- [ ] No prompt content in any log
- [ ] Fail-open verified

---

## Session Notes

_(Record fault-injection findings and performance numbers here.)_

---

**End of Milestone 0.5.0.0 Specification**
