# TASKS.md: AI Prompt Assistant Milestone Tracker

**Last Updated**: 2026-08-13
**Current Version**: 0.0.4.5

---

## Completed Milestones

| Milestone | Status | Date Completed | Tasks | Description |
|---|---|---|---|---|
| [0.0.1.0](./tasks/Milestone0.0.1.0.md) | Complete | 2026-08-12 | 6/6 | Project setup and scaffolding |
| [0.0.2.0](./tasks/Milestone0.0.2.0.md) | Complete | 2026-08-12 | 7/7 | Detector engine + labeled test corpus |
| [0.0.3.0](./tasks/Milestone0.0.3.0.md) | Complete | 2026-08-13 | 6/6 | Site adapter layer + submit/paste interception |
| [0.0.4.0](./tasks/Milestone0.0.4.0.md) | Complete | 2026-08-13 | 6/6 | Approval modal + risk badge (Shadow DOM UI) |

---

## Active / In Progress

| Milestone | Status | Priority | Description |
|---|---|---|---|
| [0.0.5.0](./tasks/Milestone0.0.5.0.md) | Ready | HIGH | Vault + response re-hydration |

---

## Pending

| Milestone | Status | Priority | Description |
|---|---|---|---|
| [0.0.6.0](./tasks/Milestone0.0.6.0.md) | Planning | MEDIUM | Settings, allowlist, popup + options page |
| [0.1.0.0](./tasks/Milestone0.1.0.0.md) | Planning | MEDIUM | Multi-platform adapters (Claude, Gemini) |
| [0.2.0.0](./tasks/Milestone0.2.0.0.md) | Planning | HIGH | Hardening, resilience, performance, e2e, a11y |
| [0.3.0.0](./tasks/Milestone0.3.0.0.md) | Planning | HIGH | Onboarding and first-run experience |
| [0.9.0.0](./tasks/Milestone0.9.0.0.md) | Planning | HIGH | Beta: unlisted store deploy + real-user testing |
| [1.0.0.0](./tasks/Milestone1.0.0.0.md) | Planning | CRITICAL | Public Chrome Web Store launch |

---

## Roadmap Notes

**Critical path to launch**: 0.0.2.0 → 0.0.3.0 → 0.0.4.0 are the product. Everything
before is scaffolding and everything after is polish, reach, and distribution.

**Today's EOD target** is a dogfoodable v0: 0.0.1.0 through 0.0.4.0. That gives a
working catch-and-approve loop on ChatGPT. Re-hydration (0.0.5.0) is the stretch.

**Post-1.0 milestones are intentionally not planned yet.** Prompt refinement, the team
tier, and custom pattern support all depend on what launch data says users actually
do. Planning them now would be fiction. They get milestone files once 1.0.0.0 ships
and there is real usage to reason about.

**Version scheme note**: 0.1.0.0 and 0.2.0.0 bump MINOR because they represent phase
changes (multi-platform reach, then production hardening) rather than incremental
feature work. 0.9.0.0 is beta per the project versioning convention; 1.0.0.0 is the
first public release.

---

_Milestone details, task lists, and session notes live in `./tasks/`. This file is the dashboard. Keep it lean._
