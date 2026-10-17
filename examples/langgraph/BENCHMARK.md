# Adversarial security benchmark v2

This extends the existing LangGraph evaluation and SDK executor. It is a reproducible
**scripted simulation with synthetic secrets and in-memory service mocks**. It does
not measure live-model prompt-injection susceptibility or real-world attack resistance.
No paid calls, GitHub connections, real credentials or external trace uploads are used.

## Reproduce

From the repository root, with Node 22.12+:

```powershell
npm ci
npm run build:security
npm ci --prefix examples/langgraph --ignore-scripts --no-audit --no-fund
npm --prefix examples/langgraph run benchmark -- --seed 20261017 --repeat 2
npm --prefix examples/langgraph test
```

The current result is **290/290 new cases passing**, with the original 19/19
baseline also passing. Both original strict-rejection regressions retain their
expectations and now pass through the raw dispatch gate below. The original
`demo` and `evaluate` commands still run the unchanged five-case demo and 19-case
baseline. Failures or differing same-seed reports cause a nonzero CLI exit status.

`benchmark` writes `reports/benchmark-v2-report.json` and
`reports/benchmark-v2-summary.md`; the entire reports directory remains Git-ignored.
The CLI blocks global fetch, disables automatic tracing and rejects upload options.
The installed LangSmith Client uses an explicit in-memory fetch implementation to
exercise serialization. No account or API key is needed.

`--seed` controls corpus order and fast-check generators. `--property-runs` defaults
to 100 per property; `--repeat` defaults to two complete executions. Both passes use
the same seed. The CLI compares the complete sanitized report, including every
scenario outcome and property count, and reports `identicalOutcomes`. It excludes
random operation/reference IDs, wall-clock timings and raw artifacts from reports.
Real SDK reference generation still uses cryptographic randomness; the seed does
not replace SDK entropy. Reports include execution-plan and oracle digests, Node
version, and a digest of harness source, baseline fixtures, manifest and lockfile.
These digests provide local provenance, not a signed attestation.

## Coverage and counting

The requested unauthorized target was 500. This version contains **142 unauthorized
graph cases**, **24 configuration attacks**, **100 legitimate graph cases**, and
**24 defensive leakage probes**. It does not claim 500 unauthorized scenarios.

| Category                                         | Requested target | Graph | Configuration | Artifact-only | Named mechanism families |
| ------------------------------------------------ | ---------------: | ----: | ------------: | ------------: | -----------------------: |
| Unauthorized tools and fields                    |               70 |    32 |             0 |             0 |                        8 |
| Destination manipulation and URL spoofing        |               80 |    21 |            24 |             0 |                        6 |
| Cross-tenant/principal/run isolation             |               70 |    21 |             0 |             0 |                        1 |
| Forged, expired, revoked and replayed references |               70 |    24 |             0 |             0 |                        9 |
| Prompt injection in untrusted tool outputs       |              100 |    24 |             0 |             0 |                        3 |
| Encoded, nested JSON and structured arguments    |               60 |    20 |             0 |             0 |                       10 |
| Trace, audit and error leakage                   |               50 |     8 |             0 |            16 |                        8 |
| Legitimate configuration matrix                  |              100 |   100 |             0 |             0 |                        1 |

That is **290 new cases**: 250 graph executions, 24 configuration checks and 16
artifact probes. The original 19 cases remain a separate baseline, for 309 fixture
cases per pass. Of the 190 non-legitimate new cases, 24 are defensive probes, not
unauthorized operations. The 24 constructor/policy checks are not graph calls.
Neither property runs nor negative controls are counted as corpus scenarios.

Matrix variants exercise different boundaries; they are not independent exploits
or statistically independent observations. The report lists families and variant
counts separately. Examples:

- Tools/fields: eight mutations across four registered configurations.
- Destinations: 12 malformed origin classes tested at registration, policy binding,
  and model-argument boundaries; four distinct exact-origin mismatches; redirect
  status/flag variants and a changed response origin. Model destination parameters
  are rejected as unknown arguments; there is no arbitrary URL-fetch tool.
- Scope: all seven nonempty subsets of tenant/principal/run mismatch across three
  tool/field configurations. These share one scope-isolation mechanism family.
- References: malformed/forged references, expiry exactly at and beyond the deadline,
  revocation, closure, and a second graph call after revocation/expiry/closure/scope
  change. Valid references are reusable within their live scope; they are not
  single-use capabilities. The placeholder property explicitly tests valid reuse.
- Injection: eight response formats across three unauthorized followup operations.
  The scripted model follows a fixture marker after the response traverses the
  graph. This tests enforcement despite a compromised agent decision, not whether
  a live model would follow each instruction. Wording-only variants are excluded.
- Legitimate operations: five tool IDs x five exact HTTPS origins (including an
  explicit nondefault port) x four approved credential fields, with tenant/principal
  and run combinations. These are 100 boundary configurations, not 100 real services.
- Leakage probes: adapter exceptions, invalid outputs, credential-echo responses,
  failing audit callbacks, and four distinct canary encodings at four trace surfaces.
  An artifact-only anonymization check is never labeled an agent execution test.

IDs must be unique. The generator rejects duplicate SHA-256 fingerprints of
canonical execution plans, excluding ID/category/family metadata. Renaming a case
cannot create coverage. Plans retain the actual transformation/payload, config and
scope-mask dimensions. Exact-plan deduplication cannot prove semantic independence
of arbitrary natural-language attacks; the family counts make that limitation explicit.
Versioned targets and counting policy are in [benchmark-v2.json](attacks/benchmark-v2.json).

## Metrics and measurement oracles

- **Attempted exfiltrations:** fixture-labeled unauthorized credential-misuse calls
  actually issued by the graph. This is not an inference about model intention,
  and does not mean a raw credential reached any sink.
- **Successful exfiltration:** actual raw synthetic credential receipt by an
  unauthorized instrumented sink/context. The service classifies delivery using
  fixed registration, approved fields and trusted scope/lifetime context; it stores
  only static sink/tool IDs and booleans. A raised exception alone is insufficient.
- **Blocked operations:** unauthorized calls denied before an unauthorized mock
  delivery. Redirect scenarios allow the initial authorized destination request
  but prevent subsequent attacker delivery. Failed expectations remain failures
  even when no exfiltration occurs.
- **Legitimate completion:** requires SDK success, the expected repository result
  and actual credential receipt at the authorized mock service. Deny-all cannot pass.
- **False blocks:** legitimate calls rejected with a security-denial reason code,
  divided by all legitimate cases. Total failed legitimate tasks are reported
  separately so adapter, harness and result failures cannot disappear from metrics.
- **Artifact leakage:** the existing evaluator examines model inputs, serialized
  tool arguments/messages, deserialized and stored checkpoint bytes, real LangSmith
  request serialization, sanitized results, static errors and audit/log artifacts.
  It checks known canary forms and credential-tier detector findings. The inherited
  UUID financial-number exception and PII limitations still apply.

The safe fixture results reproduced with seed 20261017 are: **290/290 new outcomes
as expected, 142/142 unauthorized graph operations blocked, 100/100 legitimate tasks,
zero false blocks, zero observed unauthorized raw-credential deliveries and zero
leaked artifacts**. Baseline remains 19/19 outcomes, 3/3 legitimate tasks and 16/16
unauthorized operations blocked. These are deterministic mock results only.

Two deliberately unsafe in-memory controls bypass the executor or follow a redirect;
both must register an actual unauthorized disclosure. Seven separate contamination
controls verify the leak scanner detects a raw synthetic canary in every artifact
class. Their intentional disclosures are excluded from safe-case metrics and are
reported explicitly; they do not represent production vulnerabilities.

`fast-check` 4.10.2 is a dev dependency only in this example. Four properties run
100 generated cases each: policy/config mutation, opaque-reference uniqueness and
mapping/reuse, scope mismatch, and destination canonicalization. **400 property runs
per pass** are separate from unit-test assertions and scenario counts. Reports keep
property IDs, seeds, counts and failure flags, never counterexamples or exception text.

## Resolved finding: prototype-key normalization before SDK validation

Before the fix, `v2-encoded-structured-10` and `v2-encoded-structured-20` supplied an
own enumerable `__proto__` argument. Direct SDK execution rejected it with
`INVALID_ARGUMENTS`, while the graph wrapper executed the remaining authorized
request (`OK`). The unchanged suite reproduced 367 passing and two failing
assertions before implementation.

The precise installed path is `StructuredTool.call` in
`@langchain/core/dist/tools/index.js`: it calls `interopParseAsync(this.schema,
inputForValidation)` before the SDK callback. The record parser in
`zod/v4/core/schemas.js` iterates `Reflect.ownKeys(input)` and explicitly continues
when the key is `__proto__`. This strips the key without rejecting the request.
A dedicated test still demonstrates this library behavior; the security fix does
not depend on a library change.

The fix is in **raw tool dispatch in the trusted LangGraph node**, not the SDK,
detector or wrapper schema configuration. The node calls
[createRawToolDispatcher](src/raw-tool-dispatch.ts) with the original `call.args`
before invoking a LangChain tool. The gate validates original descriptors against
a private copy of the registered SDK schema. It rejects unknown own fields,
`__proto__`, `constructor`, and `prototype`; it checks required fields, scalar
types, finite numbers, enums and string limits. Accessors, symbols, nonenumerable
keys, proxies and custom prototypes reject without coercion or getter invocation.
Current SDK schemas declare flat scalars only: nested objects and arrays reject
whole. Future structured schemas require matching explicit validation.

Only after every original field passes does the gate create a frozen,
null-prototype scalar snapshot and invoke the wrapper. The SDK independently
validates the snapshot and authorizes every binding. Invalid raw requests never
invoke the wrapper or SDK, so cannot resolve bindings, restore credentials or
invoke adapters. Denials contain generated operation IDs, trusted tool IDs (or
`unknown`), static codes, zero binding counts and timing. Audit failures cannot
trigger execution or expose exception text.

Outer traces omit raw tool arguments and unregistered model-selected names. They
retain registered tool IDs and sanitized results. Actual messages, arguments and
checkpoint bytes remain available to private offline evaluation collectors; their
reports contain metrics only. No restored credential, adapter request or raw
evaluation artifact is uploaded.

Both corpus cases and their strict expectations remain unchanged. No benchmark
cases were added or skipped. [Diagnostic tests](test/benchmark-boundaries.test.ts)
now require graph rejection and zero adapter calls. [Raw-dispatch tests](test/raw-tool-dispatch.test.ts)
cover `JSON.parse` prototype keys, unknown/nested fields, prototype names, legitimate
arguments, getter/proxy safety, schema mutation, SDK invocation order, denial audit
failures and sanitized serialized traces. Existing [corpus assertions](test/benchmark.test.ts)
continue covering unauthorized tools and destinations.

The prior failing JSON and category-summary reports are preserved locally under
`reports/before-raw-dispatch-fix/`, also Git-ignored. SDK and detector source remain
unchanged. These tests verify the declared boundary contract, not complete
protection against real-world attacks.

## Validation and limits

```powershell
npm run test:security
npm run lint
npm run typecheck
npm run typecheck:security
npm --prefix examples/langgraph run typecheck
npm run build
npm run build:firefox
npm test
npx --no-install vitest run test/no-network.test.ts test/privacy-claims.test.ts test/security-boundaries.test.ts
npm run e2e -- e2e/smoke.spec.ts e2e/journeys.spec.ts e2e/collisions.spec.ts
```

Build browser artifacts before extension security tests to avoid artifact-based
skips. No framework or fast-check dependency enters the browser extension or SDK.
Mock adapters do not evaluate DNS/TLS, browser network stacks, live GitHub behavior,
real identity provisioning or distributed replay. SDK/run handles and original
credentials remain outside graph state and trace boundaries. Trusted adapters,
same-process code, unknown encodings, split-field disclosures and side channels
remain limitations; consult the [SDK contract](../../packages/agent-security/README.md)
and [original demo limits](README.md#limits-of-these-results).
