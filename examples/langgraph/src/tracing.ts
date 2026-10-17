import { randomUUID } from 'node:crypto';
import { Client } from 'langsmith';
import type { TraceAnonymizer, Json } from './anonymizer.js';

export function disableAutomaticTracing(): void {
  process.env.LANGSMITH_TRACING = 'false';
  process.env.LANGCHAIN_TRACING_V2 = 'false';
}
export interface SafeTrace {
  id: string;
  name: 'scripted-agent' | 'guarded-tool';
  run_type: 'chain' | 'tool';
  start_time: number;
  end_time: number;
  inputs: Record<string, Json>;
  outputs: Record<string, Json>;
}
export function createTraceCollector(anonymize: TraceAnonymizer) {
  const runs: SafeTrace[] = [];
  return {
    record(name: SafeTrace['name'], inputs: unknown, outputs: unknown): void {
      const at = Date.now();
      runs.push({
        id: randomUUID(),
        name,
        run_type: name === 'guarded-tool' ? 'tool' : 'chain',
        start_time: at,
        end_time: at,
        inputs: anonymize(inputs),
        outputs: anonymize(outputs),
      });
    },
    records: (): SafeTrace[] => structuredClone(runs),
  };
}

/** Final allowlist projection drops arbitrary error, tag, metadata and attachment data. */
export function projectTrace(run: SafeTrace, anonymize: TraceAnonymizer): SafeTrace {
  const safe = anonymize(run);
  const name = safe.name === 'scripted-agent' ? 'scripted-agent' : 'guarded-tool';
  const object = (value: Json | undefined): Record<string, Json> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    id:
      typeof safe.id === 'string' && /^[a-f0-9-]{36}$/.test(safe.id)
        ? safe.id
        : randomUUID(),
    name,
    run_type: name === 'scripted-agent' ? 'chain' : 'tool',
    start_time: typeof safe.start_time === 'number' ? safe.start_time : 0,
    end_time: typeof safe.end_time === 'number' ? safe.end_time : 0,
    inputs: object(safe.inputs),
    outputs: object(safe.outputs),
  };
}
export function createOfflineLangSmithClient(
  anonymize: TraceAnonymizer,
  capture: (payload: string) => void,
): Client {
  return new Client({
    apiUrl: 'https://offline-traces.invalid',
    apiKey: 'synthetic-offline-key',
    anonymizer: anonymize,
    autoBatchTracing: false,
    fetchOptions: { redirect: 'error' },
    omitTracedRuntimeInfo: true,
    tracingMode: 'langsmith',
    debug: false,
    callerOptions: { maxRetries: 0 },
    fetchImplementation: async (input, init) => {
      const request = new Request(input, init);
      const body = await request.text();
      if (body) capture(body);
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
}

export async function uploadTraces(
  runs: readonly SafeTrace[],
  anonymize: TraceAnonymizer,
  options: {
    explicitOptIn: boolean;
    environmentOptIn: boolean;
    client?: Pick<Client, 'createRun'>;
  },
): Promise<number> {
  if (!options.explicitOptIn || !options.environmentOptIn)
    throw new Error('TRACE_UPLOAD_DISABLED');
  if (!options.client && !process.env.LANGSMITH_API_KEY)
    throw new Error('TRACE_UPLOAD_KEY_REQUIRED');
  const client =
    options.client ??
    new Client({
      apiUrl: 'https://api.smith.langchain.com',
      apiKey: process.env.LANGSMITH_API_KEY,
      anonymizer: anonymize,
      omitTracedRuntimeInfo: true,
      autoBatchTracing: false,
      tracingMode: 'langsmith',
      debug: false,
    });
  try {
    for (const run of runs)
      await client.createRun({
        ...projectTrace(run, anonymize),
        project_name: 'ai-prompt-assistant-security-demo',
      });
    return runs.length;
  } catch {
    throw new Error('TRACE_UPLOAD_FAILED');
  }
}
