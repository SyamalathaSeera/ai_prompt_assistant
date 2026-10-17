import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTraceAnonymizer } from '../src/anonymizer.js';
import {
  createOfflineLangSmithClient,
  projectTrace,
  uploadTraces,
  type SafeTrace,
} from '../src/tracing.js';
import { syntheticCredential } from '../src/fixtures.js';

const canary = syntheticCredential();
const safeTrace = (): SafeTrace => ({
  id: randomUUID(),
  name: 'guarded-tool',
  run_type: 'tool',
  start_time: 1,
  end_time: 2,
  inputs: { reference: 'opaque' },
  outputs: { status: 'ok' },
});

describe('installed LangSmith trace anonymization', () => {
  it('scrubs detector-supported secrets, known arbitrary canaries, keys and encoded values', () => {
    const local = 'localCanaryValue789';
    const anonymize = createTraceAnonymizer([local]);
    const data = anonymize({
      [local]: canary,
      nested: [
        local,
        encodeURIComponent(local),
        Buffer.from(local).toString('base64'),
        Buffer.from(local).toString('hex'),
      ],
    });
    const serialized = JSON.stringify(data);
    expect(
      [canary, local, Buffer.from(local).toString('base64')].some((value) =>
        serialized.includes(value),
      ),
    ).toBe(false);
  });

  it('omits deep, cyclic, proxy and getter data without invoking untrusted code', () => {
    const getter = vi.fn(() => canary);
    const object = Object.defineProperty({}, 'value', { get: getter, enumerable: true });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: unknown = { value: canary };
    for (let i = 0; i < 30; i++) deep = { nested: deep };
    const proxy = new Proxy(
      {},
      {
        get: () => {
          throw new Error(canary);
        },
      },
    );
    const data = createTraceAnonymizer([canary])({ object, cyclic, deep, proxy });
    expect(JSON.stringify(data).includes(canary)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it('omits oversized strings rather than disclosing a truncated credential prefix', () => {
    const data = createTraceAnonymizer([canary])({ value: 'x'.repeat(131060) + canary });
    expect(data.value).toBe('[OMITTED]');
  });

  it('uses the installed Client anonymizer on real serialized request bodies entirely offline', async () => {
    const payloads: string[] = [];
    const anonymize = createTraceAnonymizer([canary]);
    const client = createOfflineLangSmithClient(anonymize, (payload) => {
      payloads.push(payload);
    });
    await client.createRun({
      id: randomUUID(),
      name: 'offline-anonymizer-test',
      run_type: 'chain',
      start_time: 1,
      inputs: { value: canary },
      outputs: { value: canary },
      error: canary,
      extra: { metadata: { value: canary } },
      project_name: 'offline-security-evaluation',
    });
    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads.some((text) => text.includes(canary))).toBe(false);
  });

  it('drops metadata, errors, tags and attachments and constrains trace identifiers', async () => {
    const payloads: string[] = [];
    const anonymize = createTraceAnonymizer([canary]);
    const poisoned = {
      ...safeTrace(),
      id: canary,
      name: canary,
      inputs: { value: canary },
      error: canary,
      tags: [canary],
      extra: { metadata: { value: canary } },
      attachments: { value: canary },
    };
    const trace = projectTrace(poisoned as unknown as SafeTrace, anonymize);
    const client = createOfflineLangSmithClient(anonymize, (payload) => {
      payloads.push(payload);
    });
    await client.createRun(trace);
    expect(payloads.some((text) => text.includes(canary))).toBe(false);
    expect(
      ['error', 'tags', 'extra', 'attachments'].some((key) => Object.hasOwn(trace, key)),
    ).toBe(false);
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])(
    'requires both explicit and environment upload opt-in (%s, %s)',
    async (explicitOptIn, environmentOptIn) => {
      const createRun = vi.fn(async () => {});
      await expect(
        uploadTraces([safeTrace()], createTraceAnonymizer([canary]), {
          explicitOptIn,
          environmentOptIn,
          client: { createRun },
        }),
      ).rejects.toThrow('TRACE_UPLOAD_DISABLED');
      expect(createRun).not.toHaveBeenCalled();
    },
  );

  it('projects traces before an explicitly enabled mock upload', async () => {
    const createRun = vi.fn(async () => {});
    const input = { ...safeTrace(), outputs: { value: canary } };
    const count = await uploadTraces([input], createTraceAnonymizer([canary]), {
      explicitOptIn: true,
      environmentOptIn: true,
      client: { createRun },
    });
    expect(count).toBe(1);
    expect(JSON.stringify(createRun.mock.calls).includes(canary)).toBe(false);
  });

  it('returns a static error if an explicitly enabled mock uploader throws sensitive data', async () => {
    await expect(
      uploadTraces([safeTrace()], createTraceAnonymizer([canary]), {
        explicitOptIn: true,
        environmentOptIn: true,
        client: {
          createRun: async () => {
            throw new Error(canary);
          },
        },
      }),
    ).rejects.toThrow('TRACE_UPLOAD_FAILED');
  });
});
