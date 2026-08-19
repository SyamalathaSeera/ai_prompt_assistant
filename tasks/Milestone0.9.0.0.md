# Milestone 0.9.0.0 - Beta: Unlisted Deploy and Real-User Testing

**Version:** 0.9.0.0
**Date Created:** 2026-08-12
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** Project versioning convention (0.9.x.x = beta / MVP testing)

Ship to real users behind an unlisted store listing. The corpus proves the detector
against documents we wrote; this milestone tests it against documents we did not.

---

## Version Information

**Current Version (at milestone start):** `0.6.0.5`
**Target Version:** `0.9.0.5`
**Git Branch:** `syamalatha-MMDDYY-0.9.0.0-ext`

---

## Progress Summary

**Completion:** 0 of 6 tasks complete (0%)

| Task                                  | Priority | Status  | Version | Verified |
| ------------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization      | SETUP    | Pending | 0.9.0.0 | -        |
| Task 1: Developer account + listing   | CRITICAL | Pending | 0.9.0.1 | -        |
| Task 2: Privacy policy + disclosures  | CRITICAL | Pending | 0.9.0.2 | -        |
| Task 3: Unlisted submission           | CRITICAL | Pending | 0.9.0.3 | -        |
| Task 4: Recruit and run beta          | HIGH     | Pending | 0.9.0.4 | -        |
| Task 5: Triage and fix                | CRITICAL | Pending | 0.9.0.5 | -        |

---

## Overview

**Objective:** 20–50 real users on real work for at least a week, with false positives
found and fixed before the public listing accumulates one-star reviews.

**Estimated Effort:** 4–6 hours of work plus 1–2 weeks of elapsed beta time

**Dependencies:** 0.3.0.0

**Why unlisted first:** store rating is permanent and heavily weighted in ranking. A
public launch with an untuned detector spends reviews that cannot be recovered.

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch `syamalatha-MMDDYY-0.9.0.0-ext`, Date Started.

---

## Task 1: Developer Account and Listing Draft (CRITICAL)

**Version:** 0.9.0.1

### Implementation Steps

1. Register the Chrome Web Store developer account (one-time fee) and complete
   verification early — it can gate submission unexpectedly.
2. **Resolve the extension name before anything else.** Confirm current Chrome Web Store
   branding policy on referencing other companies' products. Assume the name cannot imply
   affiliation with OpenAI/Anthropic/Google, and that compatibility can only be described
   in the listing body. Renaming after launch forfeits reviews and ranking.
3. Draft listing copy leading with the privacy claim, not the feature list.
4. Choose the category and keyword set deliberately — store search is a primary
   discovery channel toward the 10k goal.

### Testing

- [ ] Account verified and able to submit
- [ ] Name checked against current policy and documented in Session Notes

---

## Task 2: Privacy Policy and Data Disclosures (CRITICAL)

**Version:** 0.9.0.2

### Implementation Steps

1. Write and host a privacy policy. It should be unusually short, because the honest
   answer is "we collect nothing."
2. Complete the store's data-usage disclosures accurately. Declare the remote selector
   config from 0.2.0.2 if it is enabled — an inaccurate disclosure is a takedown risk far
   worse than disclosing a benign fetch.
3. Justify every requested permission in the listing; unjustified permissions are a
   common rejection cause.
4. Re-verify that the codebase matches every claim made.

### Testing

- [ ] Policy URL live and reachable
- [ ] Disclosures match actual behavior, including the config fetch
- [ ] Every manifest permission has a stated justification

---

## Task 3: Unlisted Submission (CRITICAL)

**Version:** 0.9.0.3

### Implementation Steps

1. `npm run build` → production zip. Verify no source maps and no dev logging.
2. Verify the built manifest: version `0.9.0.x`, one host permission, no stray permissions.
3. Submit as **unlisted**.
4. Record actual review turnaround in Session Notes — this number drives the 1.0.0.0 plan.
5. Install from the store link on a clean profile and re-run the full journey.

### Testing

- [ ] Store build works on a clean Chrome profile
- [ ] No dev artifacts in the bundle
- [ ] Full journey passes from a store install

---

## Task 4: Recruit and Run Beta (HIGH)

**Version:** 0.9.0.4

### Implementation Steps

1. Recruit 20–50 developers who paste real material into LLMs daily.
2. Ask specifically for: false positives, missed secrets, anything that felt annoying,
   and anything that broke the chat.
3. Provide a reporting path that never requires sending the real value — ask for the
   rule id and a synthetic equivalent, per the bug template addendum.
4. Run for at least one full week of normal work.

### Testing

- [ ] Reports arriving through the intended channel
- [ ] No reporter needs to share a real secret to file one

---

## Task 5: Triage and Fix (CRITICAL)

**Version:** 0.9.0.5

### Implementation Steps

1. Every false positive becomes a negative corpus fixture before it is fixed.
2. Every miss becomes a positive fixture.
3. Re-run metrics; confirm the PRD gates still hold after tuning.
4. File bugs via `/bug-add` using the redaction addendum.
5. Decide go/no-go for public launch against the PRD quality criteria — honestly. If
   precision is below target, run another beta round rather than launching.

### Testing

- [ ] Corpus grown by every reported case
- [ ] Precision/recall gates pass after tuning
- [ ] No open CRITICAL or HIGH bugs

### Success Criteria

- The detector has been tested against material nobody on the project wrote
- Go/no-go decision recorded with the numbers behind it

---

## Session Notes

_(Record review turnaround, beta feedback themes, and corpus additions here.)_

---

**End of Milestone 0.9.0.0 Specification**
