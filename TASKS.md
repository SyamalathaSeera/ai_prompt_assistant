# TASKS.md: AI Prompt Assistant Milestone Tracker

**Last Updated**: 2026-08-14
**Current Version**: 0.4.0.4

---

## Completed Milestones

| Milestone | Status | Date Completed | Tasks | Description |
|---|---|---|---|---|
| [0.0.1.0](./tasks/Milestone0.0.1.0.md) | Complete | 2026-08-12 | 6/6 | Project setup and scaffolding |
| [0.0.2.0](./tasks/Milestone0.0.2.0.md) | Complete | 2026-08-12 | 7/7 | Detector engine + labeled test corpus |
| [0.0.3.0](./tasks/Milestone0.0.3.0.md) | Complete | 2026-08-13 | 6/6 | Site adapter layer + submit/paste interception |
| [0.0.4.0](./tasks/Milestone0.0.4.0.md) | Complete | 2026-08-13 | 6/6 | Approval modal + risk badge (Shadow DOM UI) |
| [0.0.5.0](./tasks/Milestone0.0.5.0.md) | Complete | 2026-08-13 | 5/5 | Vault + response re-hydration |
| [0.0.6.0](./tasks/Milestone0.0.6.0.md) | Complete | 2026-08-13 | 5/5 | Settings, allowlist, popup + options page |
| [0.1.0.0](./tasks/Milestone0.1.0.0.md) | Complete | 2026-08-13 | 5/5 | Multi-platform adapters (Claude, Gemini) |
| [0.2.0.0](./tasks/Milestone0.2.0.0.md) | Complete | 2026-08-13 | 6/6 | On-device model foundation |
| [0.3.0.0](./tasks/Milestone0.3.0.0.md) | Complete | 2026-08-13 | 6/6 | Prompt refinement |
| [0.4.0.0](./tasks/Milestone0.4.0.0.md) | Complete | 2026-08-14 | 5/5 | Clarify with context |

---

## Active / In Progress

| Milestone | Status | Priority | Description |
|---|---|---|---|
| _(none)_ | — | — | Run `/milestone-start 0.5.0.0` to begin the next one |

---

## Pending

| Milestone | Status | Priority | Description |
|---|---|---|---|
| [0.5.0.0](./tasks/Milestone0.5.0.0.md) | Planning | HIGH | Hardening, resilience, performance, e2e, a11y |
| [0.6.0.0](./tasks/Milestone0.6.0.0.md) | Planning | HIGH | Onboarding and first-run experience |
| [0.9.0.0](./tasks/Milestone0.9.0.0.md) | Planning | HIGH | Beta: unlisted store deploy + real-user testing |
| [1.0.0.0](./tasks/Milestone1.0.0.0.md) | Planning | CRITICAL | Public Chrome Web Store launch |

---

## Roadmap Notes

**Scope decision, 2026-08-13.** The full Extension 1 concept ships before launch:
redaction (done), prompt refinement, and clarify-with-context. Extensions 2 and 3
(chat-to-project, chat organiser) remain separate products for later, with their own
repos and listings â€” they need broad permissions that would wreck this one's
narrow-install pitch.

**Refinement runs on-device.** Chrome's built-in Prompt API was verified available on
the developer's machine (`window.LanguageModel`, availability `downloadable`), so model
work happens locally. ADR-001 survives: no backend, no API keys, no per-user cost, and
"nothing you type leaves this device" stays literally true. See ADR-007 (written in
0.2.0.5).

**Ordering rationale.** Hardening and onboarding were renumbered from 0.2.0.0/0.3.0.0 to
0.5.0.0/0.6.0.0 so they come *after* the feature set is complete. Hardening a product
that is about to triple in surface area would waste most of the e2e suite and the
performance budget; onboarding should introduce the features that will actually exist.

**Critical path to a usable product** was 0.0.2.0 â†’ 0.0.3.0 â†’ 0.0.4.0, all complete. The
redaction half is finished and verified against the live page.

**Post-1.0 remains unplanned**: the team tier, custom patterns, and shared policy all
depend on launch data. Planning them now would be fiction.

**Version scheme note**: each MINOR bump marks a phase change â€” reach, then model
capability, then two features, then production readiness. 0.9.0.0 is beta per the
project convention; 1.0.0.0 is the first public release.

---

_Milestone details, task lists, and session notes live in `./tasks/`. This file is the dashboard. Keep it lean._


