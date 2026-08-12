# PRD.md: AI Prompt Assistant Product Requirements

> What we're building, why, and for whom. Updated only when product direction changes.
> Implementation specifics belong in ARCHITECTURE.md and milestone files.

---

## Vision

Make it structurally impossible to accidentally leak a secret into an AI chat, without
the user changing how they work or giving up any convenience.

---

## Problem Statement

People paste real material into LLM chats all day: stack traces containing connection
strings, `.env` files, config blocks with live API keys, customer records, internal
URLs. The risky moment is almost never deliberate — it is a fast paste during
debugging.

Once sent, the data is out. It sits in a third-party account, is potentially retained,
and in a work context may constitute a compliance incident. Existing controls are
either enterprise network appliances that individuals never see, or nothing at all.

Nobody is protecting the individual developer at the moment of paste.

---

## Target Users

| User Type | Description | Primary Needs |
|---|---|---|
| Individual developer | Uses ChatGPT/Claude daily for debugging; pastes logs, configs, and code without thinking | Catch secrets before send, with near-zero friction and no false alarms |
| Security-conscious professional | Lawyer, clinician, finance, consultant handling client data in AI chats | Detect PII/PHI-shaped content; provable local-only processing |
| Team lead / security owner _(post-MVP)_ | Responsible for what the team sends to AI vendors | Shared policy, custom patterns, audit visibility |

The MVP is built for the first group. The third is the monetization path and must not
distort v1 scope.

---

## MVP Definition

The smallest version that delivers real value.

**In scope for MVP:**
- [ ] Detect high-confidence structured secrets in the draft prompt (keys, tokens, connection strings, cards, PEM blocks)
- [ ] Detect soft PII as low-confidence suggestions (email, phone, address, IDs)
- [ ] Intercept submission (Enter and button) and paste events on ChatGPT
- [ ] Approval modal: show findings, offer redacted version, allow accept / edit / send anyway
- [ ] Re-hydrate placeholders back to real values in the model's rendered response
- [ ] Per-value allowlist ("never flag this")
- [ ] Local catch counter
- [ ] Zero network requests — verifiable by the user in DevTools
- [ ] Onboarding that produces a live catch within 30 seconds of install

**Out of scope for MVP (future):**
- Prompt refinement (needs a model — BYOK or on-device, later)
- Clarify-with-context (low value; the model already sees the conversation)
- Team policy, shared allowlists, audit log, SSO
- Chat-to-project conversion (separate product — see conversation history)
- Chat history organization (separate product)

---

## Core Features

### Detection
A local, two-tier rule engine. High-confidence structured secrets are flagged
assertively and block submit until resolved. Soft PII is suggested but never blocks.
Detection quality is measured against a labeled corpus with precision and recall as a
release gate — a tool that cries wolf gets uninstalled within a week.

### Interception
Passive by default. The user does not have to remember to invoke anything. The
extension watches paste events (the highest-risk moment) and submit intents, and shows
a live risk indicator near the composer as the draft changes.

### Redaction & Re-hydration
Sensitive values are replaced with stable, descriptive placeholders that preserve
enough shape for the model to reason about the task. When the response comes back
containing a placeholder, the extension swaps the real value back into the rendered
output locally. The user never has to mentally translate — this is what makes
redaction feel free rather than lossy.

### Control
The user approves every modification. Nothing is rewritten silently. Any value can be
permanently allowlisted, and any rule family can be turned off.

---

## Success Criteria

**Product quality (gates the launch):**
- [ ] Precision ≥ 0.98 on the high-confidence tier against the labeled corpus (a false positive here is worse than a miss)
- [ ] Recall ≥ 0.90 on the high-confidence tier
- [ ] Detection adds < 50ms on a 10KB paste
- [ ] Zero network requests observable in DevTools during a full session
- [ ] Extension never blocks or breaks the host chat, including when the adapter fails to find the composer

**Adoption (the stated business goal):**
- [ ] 10,000+ Chrome Web Store installs
- [ ] ≥ 4.5 average store rating
- [ ] Week-4 retention ≥ 40% (uninstall rate is the honest signal for a passive tool)
- [ ] Median user sees ≥ 1 genuine catch in their first week

---

## Constraints & Requirements

**Technical constraints:**
- Must run entirely on-device. No backend, no telemetry, no network calls in v1.
- Manifest V3 compliant. No remotely loaded code — only fetched *data* (selectors, flags).
- Must not degrade host page performance or interfere with normal chat usage.
- Must fail open: any internal error leaves the chat fully usable.

**Non-functional requirements:**
- Performance: detection under 50ms for a 10KB draft; no perceptible typing lag
- Security: detected values never logged, never written to persistent or synced storage
- Privacy: install-time permissions limited to a single host; all others opt-in
- Accessibility: approval modal fully keyboard-navigable, focus-trapped, screen-reader labeled

**Distribution constraints:**
- Extension name and listing must not imply affiliation with OpenAI, Anthropic, or Google. Verify Chrome Web Store branding policy before finalizing the name — renaming post-launch forfeits accumulated reviews and search ranking.

---

**Last updated**: 2026-08-12
**Status**: Draft
