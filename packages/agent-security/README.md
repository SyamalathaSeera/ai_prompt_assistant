# Agent Security Core (Phase 1)

A Node TypeScript SDK with no runtime dependencies, no network client, no logging,
and no LangChain, LangGraph or LangSmith integration. Build from this repository;
consumers use its bundled ESM export and self-contained declarations. Node 22.12+
is the supported build/runtime baseline.

## Minimal trusted application example

```ts
import { createAgentSecurity } from '@ai-prompt-assistant/agent-security';

const origin = 'https://service.example.test';
const security = createAgentSecurity({
  tools: [
    {
      id: 'records.lookup',
      origin,
      input: {
        credential: { type: 'string', secret: true },
        query: { type: 'string', enum: ['status'] },
      },
      output: { message: { type: 'string' } },
      // Synthetic, offline adapter. No connection is made.
      invoke: async (request) => ({
        status: 200,
        origin: request.origin,
        redirected: false,
        data: { message: 'success' },
      }),
    },
  ],
});
const run = security.run({ tenantId: 'tenant-a', principalId: 'user-a', runId: 'run-a' });
const credential = run.bind('syntheticCredential123', {
  grants: [{ toolId: 'records.lookup', origin, fields: ['credential'] }],
});
// Only the opaque reference belongs in model messages or graph state.
const result = await run.execute('records.lookup', { credential, query: 'status' });
run.dispose();
```

`run.redact(text, policy)` uses the existing detector facade and exact matches for
currently registered values, replacing the union of sensitive spans with opaque
references. It deduplicates repeated values within that call. It returns only
redacted text, references and a count. A detector cannot identify every possible
secret: explicitly bind application credentials rather than relying on detection.
Never trace/log the original text, bind arguments, adapter inputs or internal SDK
calls. Keep the core and run handles outside model-controlled state/checkpoints.

## Security contract

- Trusted application code owns run/tenant/principal scope, tool registration,
  schemas, binding policies and audit callbacks. Model arguments cannot choose or
  extend permissions. There is no public `restore` or vault lookup method.
- Grants bind an exact registered tool ID, canonical HTTPS origin and approved
  top-level credential fields. Empty grants deny. Policies, scopes, schemas,
  input snapshots and adapter requests are copied/frozen.
- Inputs/outputs use bounded flat scalar schemas with optional enum constraints. Unknown input fields, objects,
  arrays, accessors, proxies, symbols and prototype keys are rejected. Every
  supplied secret field must contain exactly one opaque reference; interpolation
  and partial references are rejected. No automatic retries are performed.
- All bindings are authorized before the adapter is invoked. There is no await
  between validation, restoration and invocation. Expiry/revocation after an
  adapter starts cannot undo that side effect. In-flight credentials remain in
  the private egress scrub set until the adapter finishes.
- An adapter receives a fixed canonical `origin`, `redirect: 'error'` and frozen
  restored arguments. The adapter is part of the trusted execution boundary and
  MUST enforce the supplied destination and redirect mode in its transport before
  sending anything. Do not wrap a generic URL-fetching or shell tool. The SDK
  additionally rejects redirect statuses, reported redirects and changed response
  origins. These response checks cannot undo a transport that already followed a
  redirect. DNS resolution, IP egress restrictions, TLS, endpoint/path choice and
  response limits remain the trusted adapter's responsibility.
- Origin strings must already equal their canonical origin: no paths, userinfo,
  fragments, queries, whitespace, default `:443`, trailing dots, Unicode aliases,
  IP literals or localhost. Explicit nondefault ports require matching trusted
  tool configuration and policy. No arbitrary URL-fetch API is exported.
- Output fields are allowlisted; extra fields are dropped. Fields containing known
  plaintext/URI/base64/hex credential forms, references or detector matches become
  `null`. Invalid output and adapter errors return static reason codes, never
  request/response bodies, exception text or stacks. Arbitrary secret encodings,
  splitting across fields, malicious trusted adapters and side channels cannot be
  comprehensively detected: return narrow service results, never raw bodies.
- Audit events contain only operation ID, registered tool ID (or `unknown`),
  outcome, static reason code, binding count and elapsed milliseconds. Audit
  delivery is best effort; metadata matching a registered secret is withheld; `auditDelivered` reports success. A failed sink does
  not rerun or roll back a tool. No event contains scope IDs, references, arguments,
  URLs, secret hashes or untrusted error strings.

## Memory and lifetime

The process-local vault defaults to 200 entries, 1 MiB of UTF-8 value bytes, fixed
5-minute expiry, and 10,000 issued references per core lifetime. Limits are
configurable within hard ceilings. Binding batches commit synchronously and
atomically within one JavaScript isolate. Values are never persisted. Expiry,
revocation and run disposal remove active values; issued-reference tombstones
prevent reuse and are separately bounded. Capacity/exhaustion, invalid clocks and
entropy/collision failures explicitly deny. There is no automatic eviction of live
entries. Each reference uses 256 bits from Node crypto, with bounded collision
retries and checks against issued IDs, the current batch and original source text.

Redaction is limited to 65,536 UTF-16 code units and 4,096 candidate spans. Each schema has at most
64 fields and each string at most 65,536 UTF-16 code units. Use a bounded timeout/transport response
limit in real adapters. Concurrent calls are safe within the same core instance;
this is not distributed storage or a cross-process lock. JavaScript strings cannot
be securely zeroized, and malicious same-process code is outside the threat model.
Use separate workers/processes for hostile executable code.

## Build and validate (from repository root)

```sh
npm run build:security
npm run typecheck:security
npm run test:security
npm run lint
npm run build
npm run build:firefox
npm test
```

Root dev-only Vite/TypeScript tooling builds both packages. No SDK dependency is
added to the browser extension; its existing detector imports and rules are
unchanged. Boundary tests inspect runtime source imports and all built Chrome and
Firefox JavaScript. The SDK package export maps expose only their public entries.
Phase 2 integrations must remain outside this SDK and extension.
