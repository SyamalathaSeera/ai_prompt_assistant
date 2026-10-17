# Portfolio walkthrough

This review demonstrates TypeScript integration work: a shared detector, a
framework-independent policy executor, an explicit LangGraph tool boundary, and
measured offline evaluation. It uses a scripted model and an instrumented service,
not a live LLM or GitHub connection. No account, real credential, or paid call is
needed. Follow [root setup](../README.md#setup-and-run) first.

## 1. Authorized call and attacker-host denial

From the repository root:

```powershell
npm --prefix examples/langgraph run demo
```

The CLI prints sanitized metrics and writes an ignored local JSON report. To review
only the two relevant scenarios without printing tool arguments or credentials:

```powershell
$demo = Get-Content examples/langgraph/reports/demo-report.json -Raw | ConvertFrom-Json
$demo.scenarios | Where-Object { $_.id -in @('authorized-read', 'attacker-host') } | Format-Table
```

- `authorized-read` should have `expectedOutcome = True` and
  `authorizedTaskSuccess = True`. The trusted fixture binds a synthetic credential
  to `github.read`, the exact GitHub HTTPS origin, and the `credential` field.
  The graph sees only the opaque reference. The SDK authorizes it, restores it
  inside the adapter request, and returns a sanitized repository result.
- `attacker-host` should have `expectedOutcome = True`,
  `blockedUnauthorizedOperations = 1`, and `successfulExfiltrations = 0`.
  The script selects a guarded attacker tool registered to an unapproved origin.
  The binding denies it with `POLICY_DENIED` before its adapter runs. The scenario
  is an expected denial, so its `authorizedTaskSuccess = False` is appropriate.

Review [trusted tool mapping and graph nodes](../examples/langgraph/src/agent.ts),
[mock delivery instrumentation](../examples/langgraph/src/mock-service.ts), and
[versioned fixtures](../examples/langgraph/attacks/v1.json). Tool names and arguments
may be model-selected; the wrapper's SDK identity, scope, policy, and fixed
registered origin are supplied by trusted code. There is no unguarded model tool.

## 2. Offline trace-leak check

```powershell
npm --prefix examples/langgraph test
npm --prefix examples/langgraph run evaluate
$evaluation = Get-Content examples/langgraph/reports/security-report.json -Raw | ConvertFrom-Json
$evaluation.summary | Format-List
```

Expected version-1 summary: 19/19 outcomes, 3/3 authorized tasks, 16/16 unauthorized
operations blocked, zero successful mock exfiltrations, and zero leaked artifacts.
These are measured counts from the fixture suite, not a general security rating.

[Tracing tests](../examples/langgraph/test/tracing.test.ts) intentionally contaminate
inputs, outputs, keys, errors, and metadata with synthetic canaries, then inspect
actual LangSmith Client serialization using an in-memory fetch implementation.
The anonymizer removes detector-recognized values and known canary forms; final
trace projection drops untrusted metadata, tags, attachments, and errors. Raw
restoration and adapter requests are outside traced inputs/outputs.

[Integration tests](../examples/langgraph/test/integration.test.ts) inspect messages,
tool arguments, checkpoint bytes, serialized traces, outputs, errors, and audit/log
artifacts. They test the scanner with deliberate contamination and verify that an
intentionally unsafe redirect negative control registers an exfiltration. Safe
redirect scenarios never deliver the credential to the attacker sink.

Generated report files expose metrics only and are excluded by `.gitignore`:

```powershell
git check-ignore examples/langgraph/reports/demo-report.json examples/langgraph/reports/security-report.json
```

Do not enable `--upload` for this walkthrough. No trace upload is needed to exercise
the installed LangSmith serializer or evaluator.

## 3. Discuss the boundary

The extension has separate usability and display-rehydration behavior. Its
zero-network checks apply to its own runtime; the host website still sends user
submissions. The agent executor instead denies a call before adapter invocation
if any binding fails. Neither component guarantees detection of every secret.

For deployment, discuss trusted identity provisioning, transport/DNS/TLS controls,
response limits, checkpoint protection, and process isolation. A scripted mock
demonstration cannot establish arbitrary prompt-injection resistance, live-agent
reliability, or production exfiltration prevention. See the [SDK contract](../packages/agent-security/README.md)
and [demo limitations](../examples/langgraph/README.md#limits-of-these-results).
