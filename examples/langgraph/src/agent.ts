import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import {
  END,
  START,
  MemorySaver,
  MessagesAnnotation,
  StateGraph,
} from '@langchain/langgraph';
import { z } from 'zod';
import {
  createAgentSecurity,
  type AuditEvent,
  type BindingPolicy,
  type ExecutionResult,
} from '@ai-prompt-assistant/agent-security';
import { createTraceAnonymizer } from './anonymizer.js';
import {
  createTraceCollector,
  createOfflineLangSmithClient,
  projectTrace,
  disableAutomaticTracing,
} from './tracing.js';
import { createMockService } from './mock-service.js';
import { emptyArtifacts, inspectLeaks } from './evaluator.js';
import { GITHUB_ORIGIN, syntheticCredential, type Scenario } from './fixtures.js';

interface Call {
  name: string;
  args: Record<string, unknown>;
}
function view(messages: readonly BaseMessage[]) {
  return messages.map((message) => ({
    role: message.type,
    content: message.content,
    ...(AIMessage.isInstance(message) ? { tool_calls: message.tool_calls } : {}),
  }));
}

export async function runScenario(scenario: Scenario) {
  disableAutomaticTracing();
  const canary = syntheticCredential();
  const artifacts = emptyArtifacts();
  const audit: AuditEvent[] = [];
  const anonymize = createTraceAnonymizer([canary]);
  const traces = createTraceCollector(anonymize);
  const behavior =
    scenario.kind === 'echo'
      ? 'echo'
      : scenario.kind === 'redirect'
        ? 'redirect'
        : scenario.kind === 'response-injection'
          ? 'injection'
          : 'normal';
  const contextAuthorized = ![
    'cross-run',
    'cross-tenant',
    'cross-principal',
    'expired',
    'revoked',
    'forged',
    'mixed-bindings',
    'wrong-field',
    'malformed-destination',
    'scope-override',
    'embedded-reference',
  ].includes(scenario.kind);
  const service = createMockService(
    canary,
    behavior,
    contextAuthorized,
    scenario.toolResponse,
  );
  let now = 0;
  const core = createAgentSecurity({
    tools: service.tools,
    clock: () => now,
    vault: { ttlMs: 10 },
    onAudit: (event) => {
      audit.push(event);
    },
  });
  const scope = Object.freeze({
    tenantId: 'tenant-demo',
    principalId: 'principal-demo',
    runId: `run-${scenario.id}`,
  });
  const owner = core.run(scope);
  const policy: BindingPolicy = {
    grants: [
      { toolId: 'github.read', origin: GITHUB_ORIGIN, fields: ['credential'] },
      // Batch allows its first credential field only; second must independently authorize.
      { toolId: 'github.batch', origin: GITHUB_ORIGIN, fields: ['credential'] },
    ],
  };
  const redacted = owner.redact(`Use this synthetic credential: ${canary}`, policy);
  let reference = redacted.references[0]!;
  let run = owner;
  if (scenario.kind === 'cross-run') run = core.run({ ...scope, runId: 'other-run' });
  if (scenario.kind === 'cross-tenant')
    run = core.run({ ...scope, tenantId: 'other-tenant' });
  if (scenario.kind === 'cross-principal')
    run = core.run({ ...scope, principalId: 'other-principal' });
  if (scenario.kind === 'expired') now = 11;
  if (scenario.kind === 'revoked') owner.revoke(reference);
  if (scenario.kind === 'forged') reference = '[[APA_SECRET_' + '0'.repeat(64) + ']]';
  const mapping = Object.freeze({
    github_read: 'github.read',
    github_delete: 'github.delete',
    attacker_collect: 'attacker.collect',
    github_batch: 'github.batch',
  });
  const results: ExecutionResult[] = [];
  const attempts: {
    authorized: boolean;
    code: string;
    ok: boolean;
    blocked: boolean;
    unauthorizedDeliveries: number;
  }[] = [];
  const wrappers = new Map(
    Object.entries(mapping).map(([name, trustedId]) => [
      name,
      tool(
        async (args: Record<string, unknown>) => {
          // Neither the raw adapter nor credential restoration is traced. Only the
          // outer opaque arguments and sanitized SDK result cross the graph boundary.
          const result = await run.execute(trustedId, args);
          results.push(result);
          return JSON.stringify(result);
        },
        {
          name,
          description: 'Guarded synthetic service; no direct transport access.',
          schema: z.record(z.string(), z.unknown()),
        },
      ),
    ]),
  );

  function initialCall(): Call {
    const args: Record<string, unknown> = {
      credential: reference,
      repository: scenario.kind === 'read-other' ? 'demo/other' : 'demo/repository',
    };
    let name = 'github_read';
    if (scenario.kind === 'wrong-tool') name = 'github_delete';
    if (scenario.kind === 'attacker-host') name = 'attacker_collect';
    if (scenario.kind === 'unknown-tool') name = 'unguarded_fetch';
    if (scenario.kind === 'malformed-destination')
      args.destination = `${GITHUB_ORIGIN}@attacker.invalid`;
    if (scenario.kind === 'scope-override') {
      args.tenantId = 'other-tenant';
      args.runId = 'other-run';
    }
    if (scenario.kind === 'wrong-field') args.note = reference;
    if (scenario.kind === 'embedded-reference') args.credential = `Bearer ${reference}`;
    if (scenario.kind === 'mixed-bindings') {
      name = 'github_batch';
      args.second = reference;
    }
    return { name, args };
  }
  let scriptedCalls = 0;
  const checkpoint = new MemorySaver();
  const graph = new StateGraph(MessagesAnnotation)
    .addNode('agent', async (state) => {
      const input = view(state.messages);
      artifacts.modelInputs.push(JSON.stringify(input));
      let call: Call | undefined;
      if (scriptedCalls === 0) call = initialCall();
      else if (
        scenario.kind === 'response-injection' &&
        scriptedCalls === 1 &&
        JSON.stringify(state.messages.at(-1)?.content).includes('attacker_collect')
      ) {
        // Deterministically simulate a model following a malicious service reply.
        call = {
          name: 'attacker_collect',
          args: { credential: reference, repository: 'demo/repository' },
        };
      }
      scriptedCalls++;
      const message = new AIMessage({
        content: call ? '' : 'Simulation complete.',
        tool_calls: call
          ? [{ ...call, id: `call-${scriptedCalls}`, type: 'tool_call' as const }]
          : [],
      });
      traces.record('scripted-agent', { messages: input }, { messages: view([message]) });
      return { messages: [message] };
    })
    .addNode('trusted_tools', async (state) => {
      const last = state.messages.at(-1);
      if (!last || !AIMessage.isInstance(last)) return { messages: [] };
      const replies: ToolMessage[] = [];
      for (const call of last.tool_calls ?? []) {
        artifacts.toolArguments.push(
          JSON.stringify({ name: call.name, arguments: call.args }),
        );
        const before = results.length;
        const deliveryOffset = service.snapshot().deliveries.length;
        let content: string;
        const wrapper = wrappers.get(call.name);
        try {
          if (wrapper) content = await wrapper.invoke(call.args, { callbacks: [] });
          else {
            const denied = await run.execute('unregistered.tool', call.args);
            results.push(denied);
            content = JSON.stringify(denied);
          }
        } catch {
          artifacts.errors.push('TOOL_EXECUTION_FAILED');
          content = JSON.stringify({ ok: false, code: 'TOOL_EXECUTION_FAILED' });
        }
        const result = results[before];
        const authorized =
          scenario.expectation === 'authorized' ||
          (scenario.kind === 'response-injection' && attempts.length === 0);
        const unauthorizedDeliveries = service
          .snapshot()
          .deliveries.slice(deliveryOffset)
          .filter((d) => !d.authorized).length;
        attempts.push({
          authorized,
          code: result?.code ?? 'TOOL_EXECUTION_FAILED',
          ok: result?.ok ?? false,
          unauthorizedDeliveries,
          blocked: !authorized && !result?.ok && unauthorizedDeliveries === 0,
        });
        traces.record(
          'guarded-tool',
          { tool: call.name, arguments: call.args },
          { result: JSON.parse(content) },
        );
        replies.push(
          new ToolMessage({ content, tool_call_id: call.id ?? 'call', name: call.name }),
        );
      }
      return { messages: replies };
    })
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', (state) => {
      const last = state.messages.at(-1);
      return last && AIMessage.isInstance(last) && last.tool_calls?.length
        ? 'trusted_tools'
        : END;
    })
    .addEdge('trusted_tools', 'agent')
    .compile({ checkpointer: checkpoint });
  try {
    const config = {
      configurable: { thread_id: scenario.id },
      callbacks: [],
      recursionLimit: 10,
    };
    const final = await graph.invoke(
      { messages: [new HumanMessage(redacted.text)] },
      config,
    );
    artifacts.outputs.push(JSON.stringify({ messages: view(final.messages), results }));
    for await (const item of checkpoint.list(config))
      artifacts.checkpoints.push(JSON.stringify(item));
    // Inspect actual stored checkpoint bytes as well as deserialized checkpoints.
    for (const namespaces of Object.values(checkpoint.storage))
      for (const entries of Object.values(namespaces))
        for (const tuple of Object.values(entries)) {
          artifacts.checkpoints.push(new TextDecoder().decode(tuple[0]));
          artifacts.checkpoints.push(new TextDecoder().decode(tuple[1]));
        }
  } catch {
    artifacts.errors.push('GRAPH_EXECUTION_FAILED');
  } finally {
    run.dispose();
    owner.dispose();
  }
  artifacts.tracePayloads.push(JSON.stringify(traces.records()));
  // Exercise the actual installed SDK serializer with an in-memory fetch, not
  // just our local trace objects. No HTTP request or account is involved.
  try {
    const offline = createOfflineLangSmithClient(anonymize, (payload) => {
      artifacts.tracePayloads.push(payload);
    });
    for (const trace of traces.records())
      await offline.createRun({
        ...projectTrace(trace, anonymize),
        project_name: 'offline-security-evaluation',
      });
  } catch {
    artifacts.errors.push('OFFLINE_TRACE_SERIALIZATION_FAILED');
  }
  artifacts.logs.push(JSON.stringify(audit));
  const transport = service.snapshot();
  const leaks = inspectLeaks(artifacts, [canary]);
  const finalAttempt = attempts.at(-1);
  const finalResult = results.at(-1);
  const expectedRepository =
    scenario.kind === 'read-other' ? 'demo/other' : 'demo/repository';
  const correctRepository =
    finalResult?.ok && finalResult.output.repository === expectedRepository;
  const expectedOutcome =
    artifacts.errors.length === 0 &&
    finalAttempt?.code === scenario.expectedCode &&
    finalAttempt.ok === (scenario.expectation === 'authorized');
  return {
    scenario,
    artifacts,
    traces: traces.records(),
    attempts,
    transport,
    leaks,
    expectedOutcome,
    authorizedTaskSuccess:
      scenario.expectation === 'authorized' &&
      expectedOutcome &&
      correctRepository &&
      transport.deliveries.some((d) => d.authorized && d.receivedCredential),
    successfulExfiltrations: transport.deliveries.filter(
      (d) => !d.authorized && d.receivedCredential,
    ).length,
  };
}
