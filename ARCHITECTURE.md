# ARCHITECTURE.md: AI Prompt Assistant

> Technical reference. Read this to understand how the system is built and why.

---

## System Overview

A Manifest V3 browser extension with **no backend**. A content script is injected into
supported LLM chat pages. It observes the composer, runs a purely local detector over
the draft text, and interrupts submission when sensitive data is found. All state lives
in `chrome.storage`. Nothing is transmitted anywhere.

The single most important structural decision is the **site adapter layer**: every
piece of host-page knowledge (selectors, DOM quirks, how to submit) is isolated behind
one interface. Host pages change their DOM frequently; the adapter is the only thing
that should ever need to change in response.

### Architecture Diagram (text)

```
                    ┌──────────────────────────────────────┐
                    │  Host page (chatgpt.com, claude.ai)  │
                    │                                      │
                    │   composer ──────┐                   │
                    └──────────────────┼───────────────────┘
                                       │ read / write / intercept submit
                    ┌──────────────────▼───────────────────┐
                    │  Content script                      │
                    │                                      │
                    │  ┌────────────────────────────────┐  │
                    │  │ adapters/  (per-host DOM only) │  │
                    │  └───────────────┬────────────────┘  │
                    │                  │ plain string       │
                    │  ┌───────────────▼────────────────┐  │
                    │  │ detector/  (PURE — no DOM/IO)  │  │
                    │  │   rules → findings → tiers      │  │
                    │  └───────────────┬────────────────┘  │
                    │                  │ Finding[]          │
                    │  ┌───────────────▼────────────────┐  │
                    │  │ ui/  (Shadow DOM, React)       │  │
                    │  │   risk badge · approval modal  │  │
                    │  └───────────────┬────────────────┘  │
                    │                  │ approved text      │
                    │  ┌───────────────▼────────────────┐  │
                    │  │ vault/  (placeholder ↔ real)   │  │
                    │  └────────────────────────────────┘  │
                    └──────────────────┬───────────────────┘
                                       │
                    ┌──────────────────▼───────────────────┐
                    │  chrome.storage                      │
                    │   .local   settings, allowlist, count│
                    │   .session vault (cleared on restart)│
                    └──────────────────────────────────────┘

              ✗ No server.  ✗ No fetch().  ✗ No telemetry.
```

---

## Tech Stack

### Extension (ai_prompt_assistant)
- **Framework**: WXT (Manifest V3, builds Chrome + Firefox from one source)
- **UI**: Preact 10 + TypeScript (strict mode) — see ADR-006
- **Styling**: Tailwind CSS, injected UI mounted in a Shadow DOM
- **Detection**: Pure TypeScript, zero dependencies, zero I/O
- **Storage**: `chrome.storage.local` and `chrome.storage.session`
- **Testing**: Vitest (unit + labeled corpus), Playwright for e2e (later milestone)
- **Deployment**: Chrome Web Store

### Backend
None. This is a deliberate product constraint, not a deferral. See ADR-001.

### Database
None. All state is per-device in `chrome.storage`.

---

## Entrypoint Structure

```
entrypoints/
├── content.ts          # injected into supported hosts
├── background.ts       # service worker: permissions, counters, install hooks
├── popup/              # toolbar popup (status, counter, quick toggles)
└── options/            # full settings, allowlist, rule tiers

lib/
├── detector/           # PURE. string -> Finding[]
│   ├── rules/          # one file per rule family
│   ├── engine.ts       # run rules, resolve overlaps, apply allowlist
│   ├── validators.ts   # Luhn, entropy, checksum helpers
│   └── types.ts
├── adapters/           # per-host DOM knowledge, nothing else
│   ├── types.ts        # SiteAdapter interface
│   ├── chatgpt.ts
│   ├── claude.ts
│   ├── gemini.ts
│   └── registry.ts     # hostname -> adapter
├── vault/              # placeholder <-> real value mapping
├── policy/             # settings schema, defaults, allowlist
└── storage/            # typed chrome.storage wrappers

components/             # React UI, all Shadow-DOM mounted
test/
└── corpus/             # labeled positive + negative fixtures
```

---

## Key Patterns

### 1. The detector is pure

`lib/detector/` accepts a string and returns `Finding[]`. It must never import from
`adapters/`, `storage/`, or anything touching `chrome.*` or the DOM.

This is what makes detection quality measurable. The entire corpus test suite runs in
milliseconds with no browser, which means precision/recall can be a CI gate.

```ts
interface Finding {
  ruleId: string;       // 'aws.access_key_id'
  label: string;        // 'AWS Access Key ID'
  tier: 'high' | 'low'; // high = auto-flag, low = suggest only
  start: number;        // char offset in source text
  end: number;
  placeholder: string;  // '[REDACTED_AWS_KEY_1]'
  // NOTE: the matched value is intentionally NOT stored on Finding.
  // The caller slices it from the source text when needed.
}
```

### 2. Two-tier detection

False-positive fatigue is the primary uninstall driver for tools in this category.

| Tier | Contents | Behavior |
|---|---|---|
| `high` | Structured secrets with a recognizable shape: AWS keys, `sk-`/`ghp_`/`xox`-prefixed tokens, JWTs, PEM headers, connection strings, Luhn-valid card numbers | Flag loudly, block submit until resolved |
| `low` | Soft PII: emails, phone numbers, addresses, IDs | Suggest quietly, never block |

A rule is only allowed in `high` if a false positive is close to impossible.

### 3. Site adapters isolate all host-page knowledge

```ts
interface SiteAdapter {
  hostPatterns: string[];
  getComposer(): HTMLElement | null;
  getText(el: HTMLElement): string;
  setText(el: HTMLElement, text: string): void;
  onSubmitIntent(cb: (e: SubmitIntent) => void): () => void;
  getMessages?(): ChatMessage[];
  observeResponse?(cb: (node: HTMLElement) => void): () => void;
}
```

Adapters prefer stable signals (`role`, `aria-*`, `contenteditable`, element semantics)
over generated class names, and each selector has a documented fallback chain. When an
adapter can't find the composer, the extension fails **silent and open** — it must never
break the user's ability to use the chat.

### 4. Injected UI is Shadow-DOM isolated

All extension UI in the page mounts into a shadow root with its own Tailwind bundle.
Host styles cannot bleed in; our styles cannot bleed out. Non-negotiable — ChatGPT
ships CSS changes constantly.

### 5. Secrets are never logged or persisted in the clear

Log the rule id and offsets. Never the value. The vault (real ↔ placeholder map) lives
in `chrome.storage.session`, which clears on browser restart and is never synced.

### 6. Fail open, never closed

Any uncaught error in the extension must leave the host page fully usable. Every
interception path is wrapped so that a detector or adapter crash falls through to normal
submission rather than trapping the user's prompt.

---

## Permissions Model

| Permission | When | Why |
|---|---|---|
| `storage` | install | settings, allowlist, counters |
| `https://chatgpt.com/*`, `https://chat.openai.com/*` | install | the launch platform |
| `claude.ai`, `gemini.google.com`, … | on demand via `optional_host_permissions` | added only when the user turns that platform on |

Every host on the install screen costs conversion. Ask for one.

---

## Architectural Decisions (ADR Log)

### ADR-001: No backend in v1
**Date**: 2026-08-12 · **Status**: Accepted

The product's core claim is that prompt content never leaves the device. A backend
would contradict the claim, add unit costs per user, require a data-handling
disclosure on the store listing, and lengthen review. Local-only detection also means
zero marginal cost from 100 to 100,000 users.

**Consequence**: prompt refinement (which needs a model) cannot ship in v1 without
either BYOK or an on-device model. Deferred deliberately.

### ADR-002: Redaction-first positioning, refinement deferred
**Date**: 2026-08-12 · **Status**: Accepted

Prompt-enhancer extensions are a saturated category with weak retention. Redaction is
less crowded, retains better because it is passive and always-on, has a distribution
hook ("you are pasting API keys into ChatGPT"), and has a credible paid tier via team
security budgets. Critically, the LLM vendors have no incentive to build it themselves,
whereas they are actively building chat folders and project artifacts.

### ADR-003: WXT over Vite + CRXJS
**Date**: 2026-08-12 · **Status**: Accepted

WXT generates the manifest, provides HMR inside content scripts, and produces Chrome
and Firefox builds from one source. Cross-browser is a cheap distribution multiplier
and CRXJS would require hand-managing MV3 edge cases.

**Risk**: smaller community than raw Vite. Mitigated by the adapter/detector split —
the valuable code is framework-agnostic and portable if WXT is ever abandoned.

### ADR-004: Detector purity as an enforced boundary
**Date**: 2026-08-12 · **Status**: Accepted

Detection quality is the product. Keeping `lib/detector/` free of DOM and I/O makes
precision and recall measurable on every commit against a labeled corpus, and lets the
same engine be reused later in a CLI, a CI check, or an enterprise proxy.

### ADR-006: Preact instead of React
**Date**: 2026-08-13 · **Status**: Accepted · **Supersedes the UI half of ADR-003**

Mounting the first component revealed that bundling React put the content script at
**202.9 kB**, loaded on every ChatGPT page, against the PRD requirement not to degrade
host page performance. Switching to Preact:

| | React | Preact |
|---|---|---|
| content script | 202.90 kB | **24.13 kB** |
| popup chunk | 191.71 kB | **11.77 kB** |
| total build | 426.32 kB | **62.95 kB** |

An 85% reduction for a UI consisting of one modal and one badge — React's weight bought
nothing this project uses.

Native Preact via `@preact/preset-vite`, **not** `preact/compat`. The compat shim would
mean an alias layer to maintain and a permanent mismatch between `@types/react` and the
actual runtime, in exchange for compatibility with React-specific libraries we do not
have. `@wxt-dev/module-react` was removed; there is no equivalent Preact module, so the
Vite plugin is configured directly.

Timing was deliberate: made while exactly one component existed. All 345 tests passed
unchanged, which is itself evidence the component model is equivalent for our purposes.

**Consequence**: React-only libraries are unavailable. Acceptable — the UI is small,
deliberately plain, and has no dependency on the React ecosystem.

### ADR-005: Session-scoped vault, never synced
**Date**: 2026-08-12 · **Status**: Accepted

Re-hydration requires mapping placeholders back to real values. Storing real secrets in
`chrome.storage.local` (persistent, disk-backed) or `.sync` (leaves the device) would
make the extension a new place secrets accumulate. `chrome.storage.session` is
memory-backed and cleared on restart.

**Consequence**: re-hydration does not survive a browser restart. Accepted — a stale
placeholder in old scrollback is a minor cost versus becoming a secret store.
