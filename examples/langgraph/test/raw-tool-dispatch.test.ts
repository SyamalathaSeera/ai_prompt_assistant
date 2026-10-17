import { describe, expect, it, vi } from 'vitest';
import { disableAutomaticTracing } from '../src/tracing.js';
disableAutomaticTracing();
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  createAgentSecurity,
  type AuditEvent,
  type Schema,
} from '@ai-prompt-assistant/agent-security';
import {
  createRawToolDispatcher,
  strictArgumentSnapshot,
} from '../src/raw-tool-dispatch.js';
import { generateCorpus } from '../src/benchmark/corpus.js';
import { graphExtension } from '../src/benchmark/execution.js';
import { runScenario } from '../src/agent.js';
import { syntheticCredential } from '../src/fixtures.js';

const schema: Schema = {
  credential: { type: 'string', secret: true },
  repository: { type: 'string', enum: ['demo/repository'] },
  note: { type: 'string', required: false, maxLength: 12 },
};
const ordinary = () => ({
  credential: 'opaque-reference',
  repository: 'demo/repository',
});

describe('original arguments reach strict validation before library normalization', () => {
  it('localizes the installed LangChain/Zod behavior without executing the SDK', async () => {
    const args = JSON.parse(
      '{"credential":"opaque-reference","__proto__":{"polluted":true}}',
    );
    let callbackHadKey = true;
    const wrapped = tool(
      async (value) => {
        callbackHadKey = Object.hasOwn(value, '__proto__');
        return 'synthetic-probe';
      },
      { name: 'normalization_probe', schema: z.record(z.string(), z.unknown()) },
    );
    expect(Object.hasOwn(args, '__proto__')).toBe(true);
    await wrapped.invoke(args, { callbacks: [] });
    expect(callbackHadKey).toBe(false);
    expect(Object.hasOwn(args, '__proto__')).toBe(true);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  it.each(['__proto__', 'constructor', 'prototype', 'destination', 'unexpected'])(
    'rejects own %s before the wrapper or SDK runs',
    async (key) => {
      const invoke = vi.fn();
      const events: AuditEvent[] = [];
      const dispatch = createRawToolDispatcher(
        [{ name: 'read', id: 'records.read', input: schema, invoke }],
        (event) => {
          events.push(event);
        },
      );
      const args = JSON.parse(
        JSON.stringify(ordinary()).slice(0, -1) + `,"${key}":{"value":"synthetic"}}`,
      );
      const result = await dispatch('read', args);
      expect(result).toMatchObject({
        ok: false,
        code: 'INVALID_ARGUMENTS',
        auditDelivered: true,
      });
      expect(invoke).not.toHaveBeenCalled();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        toolId: 'records.read',
        outcome: 'denied',
        code: 'INVALID_ARGUMENTS',
        bindingCount: 0,
      });
      expect(Object.keys(events[0]!).sort()).toEqual([
        'bindingCount',
        'code',
        'durationMs',
        'operationId',
        'outcome',
        'toolId',
      ]);
    },
  );

  it.each([
    {
      label: 'nested object',
      value: { reference: 'opaque-reference', unexpected: true },
    },
    { label: 'array', value: ['opaque-reference'] },
    {
      label: 'nested prototype key',
      value: JSON.parse('{"__proto__":{"polluted":true}}'),
    },
    { label: 'null', value: null },
    { label: 'wrong scalar', value: 1 },
  ])('rejects $label in a declared scalar field', ({ value }) => {
    expect(
      strictArgumentSnapshot({ ...ordinary(), credential: value }, schema),
    ).toBeNull();
  });

  it('rejects undeclared nested fields as a whole', () => {
    expect(
      strictArgumentSnapshot(
        { ...ordinary(), options: { credential: { reference: 'opaque-reference' } } },
        schema,
      ),
    ).toBeNull();
  });

  it('rejects getters, proxies, nonenumerable keys, symbols and custom prototypes without invoking code', () => {
    const getter = vi.fn(() => syntheticCredential());
    const getTrap = vi.fn(() => {
      throw new Error('UNTRUSTED_TRAP');
    });
    const getterArgs = Object.defineProperty(ordinary(), 'credential', {
      get: getter,
      enumerable: true,
    });
    const proxy = new Proxy(ordinary(), { get: getTrap, ownKeys: getTrap });
    const hidden = Object.defineProperty(ordinary(), 'hidden', { value: true });
    const symbol = { ...ordinary(), [Symbol('unexpected')]: true };
    const custom = Object.assign(Object.create({ inherited: true }), ordinary());
    for (const args of [getterArgs, proxy, hidden, symbol, custom])
      expect(strictArgumentSnapshot(args, schema)).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    expect(getTrap).not.toHaveBeenCalled();
  });

  it('preserves valid null-prototype arguments and freezes a scalar snapshot', () => {
    const args = Object.assign(Object.create(null), ordinary());
    const result = strictArgumentSnapshot(args, schema)!;
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    args.repository = 'changed';
    expect(result.repository).toBe('demo/repository');
  });

  it.each([
    { label: 'missing required field', args: { credential: 'opaque-reference' } },
    { label: 'invalid enum', args: { ...ordinary(), repository: 'other' } },
    { label: 'length limit', args: { ...ordinary(), note: 'x'.repeat(13) } },
    {
      label: 'nonfinite number',
      args: { credential: 'opaque-reference', repository: 'demo/repository', count: NaN },
    },
  ])('rejects $label without coercion', ({ args }) => {
    expect(strictArgumentSnapshot(args, schema)).toBeNull();
  });

  it('preserves finite number/boolean values when declared and rejects their object/array replacements', () => {
    const scalars: Schema = { count: { type: 'number' }, enabled: { type: 'boolean' } };
    expect(strictArgumentSnapshot({ count: 3, enabled: false }, scalars)).toEqual({
      count: 3,
      enabled: false,
    });
    expect(
      strictArgumentSnapshot({ count: Infinity, enabled: false }, scalars),
    ).toBeNull();
    expect(strictArgumentSnapshot({ count: [3], enabled: {} }, scalars)).toBeNull();
  });

  it('denies an unregistered tool without echoing its name or arguments', async () => {
    const events: AuditEvent[] = [];
    const dispatch = createRawToolDispatcher([], (event) => {
      events.push(event);
    });
    const result = await dispatch(syntheticCredential(), {
      credential: syntheticCredential(),
    });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_TOOL' });
    expect(events[0]?.toolId).toBe('unknown');
    expect(JSON.stringify({ result, events }).includes(syntheticCredential())).toBe(
      false,
    );
  });

  it('contains an audit failure without invoking a tool or exposing exception text', async () => {
    const invoke = vi.fn();
    const dispatch = createRawToolDispatcher(
      [{ name: 'read', id: 'records.read', input: schema, invoke }],
      () => {
        throw new Error(syntheticCredential());
      },
    );
    const result = await dispatch('read', {
      ...ordinary(),
      extra: syntheticCredential(),
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS',
      auditDelivered: false,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(JSON.stringify(result).includes(syntheticCredential())).toBe(false);
  });

  it('uses the original schema snapshot despite later caller mutation', async () => {
    const mutableSchema = { ...schema };
    const invoke = vi.fn(async () => ({
      ok: true as const,
      code: 'OK' as const,
      operationId: 'test',
      auditDelivered: true,
      output: {},
    }));
    const dispatch = createRawToolDispatcher(
      [{ name: 'read', id: 'records.read', input: mutableSchema, invoke }],
      () => {},
    );
    mutableSchema.extra = { type: 'string' };
    const result = await dispatch('read', { ...ordinary(), extra: 'unexpected' });
    expect(result.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('valid authorized arguments execute once through the raw gate and SDK', async () => {
    const adapter = vi.fn(async () => ({
      status: 200,
      origin: 'https://service.example.test',
      redirected: false,
      data: { message: 'safe' },
    }));
    const core = createAgentSecurity({
      tools: [
        {
          id: 'records.read',
          origin: 'https://service.example.test',
          input: schema,
          output: { message: { type: 'string' } },
          invoke: adapter,
        },
      ],
    });
    const run = core.run({ tenantId: 'tenant', principalId: 'principal', runId: 'run' });
    const reference = run.bind(syntheticCredential(), {
      grants: [
        {
          toolId: 'records.read',
          origin: 'https://service.example.test',
          fields: ['credential'],
        },
      ],
    });
    const sdk = vi.fn((args: unknown) => run.execute('records.read', args));
    const dispatch = createRawToolDispatcher(
      [{ name: 'read', id: 'records.read', input: schema, invoke: sdk }],
      () => {},
    );
    const rejected = await dispatch('read', {
      credential: reference,
      repository: 'demo/repository',
      extra: true,
    });
    expect(rejected.code).toBe('INVALID_ARGUMENTS');
    expect(sdk).not.toHaveBeenCalled();
    expect(adapter).not.toHaveBeenCalled();
    const allowed = await dispatch('read', {
      credential: reference,
      repository: 'demo/repository',
    });
    expect(allowed.ok).toBe(true);
    expect(sdk).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(allowed).includes(syntheticCredential())).toBe(false);
    run.dispose();
  });

  it('JSON.parse prototype payload is denied in the actual graph before SDK execution and has sanitized trace inputs', async () => {
    const fixture = generateCorpus().find((item) => item.attack === 'prototype-key')!;
    const extension = graphExtension(fixture);
    const sdk = vi.fn();
    const result = await runScenario(
      {
        id: fixture.id,
        kind: 'read',
        expectation: 'denied',
        expectedCode: 'INVALID_ARGUMENTS',
      },
      {
        ...extension,
        prepare(context) {
          const prepared = extension.prepare!(context);
          return { ...prepared, run: { ...prepared.run, execute: sdk } };
        },
        initialCall(reference) {
          const base = extension.initialCall(reference);
          return {
            ...base,
            args: JSON.parse(
              JSON.stringify(base.args).slice(0, -1) + ',"__proto__":{"polluted":true}}',
            ),
          };
        },
      },
    );
    expect(result.expectedOutcome).toBe(true);
    expect(sdk).not.toHaveBeenCalled();
    expect(result.transport.deliveries).toHaveLength(0);
    expect(result.leaks.total).toBe(0);
    expect(
      result.artifacts.tracePayloads.some(
        (text) =>
          text.includes('__proto__') ||
          text.includes('polluted') ||
          text.includes(syntheticCredential()),
      ),
    ).toBe(false);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });
});
