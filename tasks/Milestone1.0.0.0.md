# Milestone 1.0.0.0 - Public Chrome Web Store Launch

**Version:** 1.0.0.0
**Date Created:** 2026-08-12
**Date Started:** 
**Date Completed:** 
**Status:** Planning
**Based on:** PRD adoption criteria (10,000+ installs)

Go public. This milestone is mostly distribution work, not engineering — and the
distribution work is what determines whether the 10k target is reachable.

---

## Version Information

**Current Version (at milestone start):** `0.9.0.5`
**Target Version:** `1.0.0.5`
**Git Branch:** `syamalatha-MMDDYY-1.0.0.0-ext`

---

## Progress Summary

**Completion:** 0 of 6 tasks complete (0%)

| Task                                | Priority | Status  | Version | Verified |
| ----------------------------------- | -------- | ------- | ------- | -------- |
| Task 0: Milestone Initialization    | SETUP    | Pending | 1.0.0.0 | -        |
| Task 1: Store listing assets        | CRITICAL | Pending | 1.0.0.1 | -        |
| Task 2: Listing SEO                 | HIGH     | Pending | 1.0.0.2 | -        |
| Task 3: Launch content              | HIGH     | Pending | 1.0.0.3 | -        |
| Task 4: Public submission           | CRITICAL | Pending | 1.0.0.4 | -        |
| Task 5: Launch week ops             | CRITICAL | Pending | 1.0.0.5 | -        |

---

## Overview

**Objective:** Public listing live, launch content published, and a support loop capable
of responding to reviews within 24 hours during launch week.

**Estimated Effort:** 8–12 hours plus launch week monitoring

**Dependencies:** 0.9.0.0 with a clean go decision

---

## Task 0: Milestone Initialization (SETUP)

Standard: version check, branch `syamalatha-MMDDYY-1.0.0.0-ext`, Date Started.

---

## Task 1: Store Listing Assets (CRITICAL)

**Version:** 1.0.0.1

### Implementation Steps

1. Icon set at all required sizes. It must read clearly at 16px in the toolbar — most
   users will only ever see it that small.
2. Screenshots at the required dimensions. **Lead with the approval modal catching a
   key**, because that single image explains the entire product. Do not lead with a
   settings screen.
3. A short demo video showing paste → catch → send redacted → re-hydrated response.
   Re-hydration is the feature people will not believe until they see it.
4. Every asset uses synthetic secrets. Audit each frame — a real key in a screenshot
   would be a spectacular own goal for a security product.

### Testing

- [ ] Icon legible at 16px
- [ ] Screenshots meet store dimension requirements
- [ ] Zero real credentials in any asset (frame-by-frame check)

---

## Task 2: Listing SEO (HIGH)

**Version:** 1.0.0.2

### Description

Store search is the largest sustainable install channel. Launch content spikes; search
compounds.

### Implementation Steps

1. Research the terms this audience actually searches. Expect privacy/security framings
   ("redact", "secrets", "privacy", "DLP") to be less contested than prompt framings.
2. Write the first two lines of the description to carry the value proposition and the
   primary keywords — that is all most people read.
3. Keep the name policy-compliant per 0.9.0.1 while remaining searchable.
4. Record the baseline keyword positions so post-launch movement is measurable.

### Testing

- [ ] Listing text reviewed against store policy
- [ ] Baseline search positions recorded in Session Notes

---

## Task 3: Launch Content (HIGH)

**Version:** 1.0.0.3

### Implementation Steps

1. Write the launch post around the *problem*, not the product: what actually happens
   when a key is pasted into a chat, and why local-only detection is the right shape of
   fix. Technical audiences reject product pitches and share problem analyses.
2. Prepare for the top comment on any privacy tool: "why should I trust you?" The answer
   is the DevTools verification, the single-host permission, the absence of any backend,
   and — if you choose to — open source.
3. Consider open-sourcing at least `lib/detector/`. For this audience it converts
   skeptics, and the moat is the corpus and distribution, not the regexes.
4. Line up posting targets and timing. One strong post beats five weak ones.

### Testing

- [ ] Every claim in the launch content is factually verifiable
- [ ] Trust objections have prepared, honest answers

---

## Task 4: Public Submission (CRITICAL)

**Version:** 1.0.0.4

### Implementation Steps

1. Bump to `1.0.0.0`, final production build.
2. Full pre-flight: permissions, disclosures, privacy policy, no dev artifacts, no
   console logging of anything sensitive.
3. Switch visibility to public and submit.
4. Expect a possible rejection round; budget for it rather than scheduling launch content
   for the day after submission.
5. Do not publish launch content until the listing is confirmed live.

### Testing

- [ ] Clean-profile install from the public listing works end to end
- [ ] Listing renders correctly on desktop and mobile store pages

---

## Task 5: Launch Week Operations (CRITICAL)

**Version:** 1.0.0.5

### Implementation Steps

1. Respond to every review within 24 hours during launch week. Early review velocity and
   sentiment disproportionately affect ranking.
2. Watch for false-positive reports as the top priority — they arrive fast at volume and
   are the main one-star driver. Ship a patch release rather than arguing in replies.
3. Track installs, uninstalls, and ratings daily against the PRD targets.
4. Every reported false positive goes into the corpus with a fix, same as beta.
5. Hold a retro at day 7 and record what the data actually says.

### Testing

- [ ] Review response process in place before launch, not after
- [ ] Patch release path verified (a fix can ship within 48 hours)

### Success Criteria

- Listing live and stable
- No CRITICAL bugs open
- Retro recorded with real numbers against PRD targets

---

## Post-Launch

Milestones beyond 1.0.0.0 are deliberately unplanned. Prompt refinement, the team tier,
and custom patterns all depend on what launch data shows. Plan them with
`/milestone-new` once there is real usage to reason about — see the roadmap note in
TASKS.md.

---

## Session Notes

_(Record submission timeline, rejection reasons if any, launch metrics, and the day-7
retro here.)_

---

**End of Milestone 1.0.0.0 Specification**
