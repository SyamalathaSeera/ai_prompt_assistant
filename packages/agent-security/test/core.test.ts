import { describe, expect, it, vi } from 'vitest';
import { createAgentSecurity, SecurityError } from '../src/index';
import type {
  AuditEvent,
  BindingPolicy,
  CoreOptions,
  FixedServiceTool,
  Scope,
  ServiceRequest,
} from '../src/index';
import { Vault } from '../src/vault';

const origin = 'https://service.example.test';
const scope: Scope = { tenantId: 'tenant-a', principalId: 'principal-a', runId: 'run-a' };
const classic = 'ghp_' + 'Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1St2Uv3Wx4';
const fine = 'github_pat_' + 'Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1St2Uv3Wx4Yz5'.repeat(2);
const policy: BindingPolicy = {
  grants: [{ toolId: 'records.lookup', origin, fields: ['credential'] }],
};

function setup(
  extra: Partial<CoreOptions> = {},
  response?: (request: ServiceRequest) => unknown,
) {
  const events: AuditEvent[] = [];
  const invoke = vi.fn(async (request: ServiceRequest) => {
    return {
      status: 200,
      origin,
      redirected: false,
      data: response ? response(request) : { message: 'success', count: 1 },
    };
  });
  const tool: FixedServiceTool = {
    id: 'records.lookup',
    origin,
    input: {
      credential: { type: 'string', secret: true },
      query: { type: 'string', required: false },
    },
    output: { message: { type: 'string' }, count: { type: 'number' } },
    invoke,
  };
  const core = createAgentSecurity({
    tools: [tool],
    onAudit: (event) => {
      events.push(event);
    },
    ...extra,
  });
  const run = core.run(scope);
  return { core, run, invoke, events, tool };
}

// Assert booleans rather than credential-bearing objects so failures cannot print values.
describe('opaque references and legitimate execution', () => {
  it('redacts mixed rules and repeated values without revealing type or value', async () => {
    const { run, invoke } = setup();
    const redacted = run.redact(`${classic} ${fine} ${classic}`, policy);
    expect(redacted.count).toBe(2);
    expect(
      redacted.references.every((r) => /^\[\[APA_SECRET_[a-f0-9]{64}\]\]$/.test(r)),
    ).toBe(true);
    expect(redacted.text.includes(classic) || redacted.text.includes(fine)).toBe(false);
    expect(redacted.text.split(redacted.references[0]!).length).toBe(3);
    for (const [i, reference] of redacted.references.entries()) {
      const result = await run.execute('records.lookup', { credential: reference });
      expect(result.ok).toBe(true);
      expect(
        invoke.mock.calls[i]![0].arguments.credential === (i === 0 ? classic : fine),
      ).toBe(true);
    }
  });

  it('creates different references across redactions and maps both correctly', async () => {
    const { run, invoke } = setup();
    const a = run.redact(classic, policy).references[0]!;
    const b = run.redact(fine, policy).references[0]!;
    expect(a !== b).toBe(true);
    await run.execute('records.lookup', { credential: a });
    await run.execute('records.lookup', { credential: b });
    expect(invoke.mock.calls[0]![0].arguments.credential === classic).toBe(true);
    expect(invoke.mock.calls[1]![0].arguments.credential === fine).toBe(true);
  });

  it('restores only inside a frozen fixed-destination adapter request', async () => {
    const { run, invoke } = setup();
    const reference = run.bind(classic, policy);
    const args = { credential: reference, query: 'status' };
    const result = await run.execute('records.lookup', args);
    expect(result.ok).toBe(true);
    const request = invoke.mock.calls[0]![0];
    expect(Object.isFrozen(request) && Object.isFrozen(request.arguments)).toBe(true);
    expect(request.origin).toBe(origin);
    expect(request.redirect).toBe('error');
    expect(args.credential === reference).toBe(true);
    expect(JSON.stringify(result).includes(classic)).toBe(false);
  });

  it('keeps vault state out of serialization and exposes no restore API', () => {
    const { core, run } = setup();
    run.bind(classic, policy);
    expect(
      JSON.stringify(core).includes(classic) || JSON.stringify(run).includes(classic),
    ).toBe(false);
    expect(Object.hasOwn(run, 'restore') || Object.hasOwn(core, 'restore')).toBe(false);
  });

  it('binds and executes concurrent operations atomically', async () => {
    const { run, invoke } = setup();
    const refs = await Promise.all(
      Array.from({ length: 24 }, async (_, i) =>
        run.bind(i % 2 ? classic : fine, policy),
      ),
    );
    expect(new Set(refs).size).toBe(24);
    const results = await Promise.all(
      refs.map((reference) => run.execute('records.lookup', { credential: reference })),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(24);
  });
});

describe('scope and reference denial', () => {
  it.each(['tenantId', 'principalId', 'runId'] as const)('isolates %s', async (key) => {
    const { core, run, invoke } = setup();
    const reference = run.bind(classic, policy);
    const other = core.run({ ...scope, [key]: 'other' });
    expect((await other.execute('records.lookup', { credential: reference })).code).toBe(
      'REFERENCE_DENIED',
    );
    expect(() => other.revoke(reference)).toThrow('REFERENCE_DENIED');
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    '[[APA_SECRET_' + '0'.repeat(64) + ']]',
    '[[APA_SECRET_invalid]]',
    'prefix [[APA_SECRET_' + 'a'.repeat(64) + ']]',
  ])('denies forged or malformed reference case %#', async (reference) => {
    const { run, invoke } = setup();
    expect((await run.execute('records.lookup', { credential: reference })).ok).toBe(
      false,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('denies expired references without sliding expiration', async () => {
    let now = 0;
    const { run, invoke } = setup({ clock: () => now, vault: { ttlMs: 10 } });
    const reference = run.bind(classic, policy);
    now = 9;
    expect((await run.execute('records.lookup', { credential: reference })).ok).toBe(
      true,
    );
    now = 10;
    expect((await run.execute('records.lookup', { credential: reference })).code).toBe(
      'REFERENCE_DENIED',
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('denies revoked references and closed runs', async () => {
    const { run, invoke } = setup();
    const reference = run.bind(classic, policy);
    run.revoke(reference);
    expect((await run.execute('records.lookup', { credential: reference })).code).toBe(
      'REFERENCE_DENIED',
    );
    const next = run.bind(fine, policy);
    run.dispose();
    expect((await run.execute('records.lookup', { credential: next })).code).toBe(
      'RUN_CLOSED',
    );
    expect(() => run.bind(classic, policy)).toThrow('RUN_CLOSED');
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { ...scope, tenantId: '' },
    { ...scope, principalId: 3 },
    { ...scope, injected: 'x' },
  ])('rejects invalid trusted scope case %#', (input) => {
    const { core } = setup();
    expect(() => core.run(input as Scope)).toThrow('INVALID_SCOPE');
  });
});

describe('immutable policies and strict model arguments', () => {
  it('denies an empty policy by default', async () => {
    const { run, invoke } = setup();
    const reference = run.bind(classic, { grants: [] });
    expect((await run.execute('records.lookup', { credential: reference })).code).toBe(
      'POLICY_DENIED',
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('copies policy and tool configuration before caller mutation', async () => {
    const { tool, invoke } = setup();
    const mutable = { grants: [{ toolId: tool.id, origin, fields: ['credential'] }] };
    const core = createAgentSecurity({ tools: [tool] });
    const run = core.run(scope);
    const reference = run.bind(classic, mutable);
    mutable.grants[0]!.fields.length = 0;
    (tool as { origin: string }).origin = 'https://attacker.example.test';
    expect((await run.execute('records.lookup', { credential: reference })).ok).toBe(
      true,
    );
    expect(invoke.mock.calls[0]![0].origin).toBe(origin);
  });

  it.each([
    { grants: [{ toolId: 'missing', origin, fields: ['credential'] }] },
    {
      grants: [
        {
          toolId: 'records.lookup',
          origin: 'https://evil.example.test',
          fields: ['credential'],
        },
      ],
    },
    { grants: [{ toolId: 'records.lookup', origin, fields: ['query'] }] },
    { grants: [{ toolId: 'records.lookup', origin, fields: ['__proto__'] }] },
  ])('rejects invalid binding policy case %#', (input) => {
    const { run } = setup();
    expect(() => run.bind(classic, input)).toThrow('INVALID_POLICY');
  });

  it('denies unauthorized registered tools before adapter invocation', async () => {
    const a = setup();
    const other = { ...a.tool, id: 'other.lookup' };
    const run = createAgentSecurity({ tools: [a.tool, other] }).run(scope);
    const reference = run.bind(classic, policy);
    expect((await run.execute('other.lookup', { credential: reference })).code).toBe(
      'POLICY_DENIED',
    );
    expect(a.invoke).not.toHaveBeenCalled();
  });

  it('does not echo unknown tool IDs', async () => {
    const { run, events, invoke } = setup();
    const result = await run.execute(classic, {});
    expect(result.code).toBe('UNKNOWN_TOOL');
    expect(JSON.stringify([result, events]).includes(classic)).toBe(false);
    expect(events[0]!.toolId).toBe('unknown');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('denies references in unapproved fields and raw credentials', async () => {
    const { run, invoke } = setup();
    const reference = run.bind(classic, policy);
    expect(
      (await run.execute('records.lookup', { credential: reference, query: reference }))
        .code,
    ).toBe('FIELD_DENIED');
    expect((await run.execute('records.lookup', { credential: classic })).code).toBe(
      'INVALID_REFERENCE',
    );
    expect(
      (await run.execute('records.lookup', { credential: reference, query: fine })).code,
    ).toBe('RAW_SECRET');
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    { credential: 'not-a-reference', url: 'https://attacker.example.test' },
    { credential: 123 },
    {},
    null,
    [],
    Object.create({ credential: 'inherited' }),
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ])('denies unknown fields and invalid argument data case %#', async (args) => {
    const { run, invoke } = setup();
    expect((await run.execute('records.lookup', args)).ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects accessors and proxies without invoking their traps', async () => {
    const { run, invoke } = setup();
    const getter = vi.fn(() => classic);
    const object = Object.defineProperty({}, 'credential', {
      enumerable: true,
      get: getter,
    });
    expect((await run.execute('records.lookup', object)).code).toBe('INVALID_ARGUMENTS');
    const trap = vi.fn(() => Object.prototype);
    expect(
      (await run.execute('records.lookup', new Proxy({}, { getPrototypeOf: trap }))).code,
    ).toBe('INVALID_ARGUMENTS');
    expect(getter).not.toHaveBeenCalled();
    expect(trap).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('snapshots arguments before the caller can mutate them', async () => {
    const { run, invoke } = setup();
    const reference = run.bind(classic, policy);
    const args = { credential: reference, query: 'original' };
    const promise = run.execute('records.lookup', args);
    args.credential = 'forged';
    args.query = 'changed';
    expect((await promise).ok).toBe(true);
    expect(invoke.mock.calls[0]![0].arguments.query).toBe('original');
    expect(invoke.mock.calls[0]![0].arguments.credential === classic).toBe(true);
  });

  it('authorizes every reference before performing any side effect', async () => {
    const { tool, invoke } = setup();
    const run = createAgentSecurity({
      tools: [
        { ...tool, input: { ...tool.input, second: { type: 'string', secret: true } } },
      ],
    }).run(scope);
    const reference = run.bind(classic, policy);
    const result = await run.execute(tool.id, {
      credential: reference,
      second: reference,
    });
    expect(result.code).toBe('POLICY_DENIED');
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('fixed destinations and redirects', () => {
  it.each([
    'http://service.example.test',
    'https://service.example.test@attacker.example.test',
    'https://name:password@service.example.test',
    'https://service.example.test/',
    'https://service.example.test/path',
    'https://service.example.test?next=evil',
    'https://service.example.test#fragment',
    'https://service.example.test:bad',
    'https://service.example.test:443',
    'https://SERVICE.example.test',
    'https://service.example.test.',
    '//service.example.test',
    'file:///tmp/example',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://service.example.test\\@evil.example.test',
    'https://service.example.test%2eevil.test',
  ])('rejects noncanonical or unsafe origin case %#', (destination) => {
    const { tool } = setup();
    expect(() =>
      createAgentSecurity({ tools: [{ ...tool, origin: destination }] }),
    ).toThrow('INVALID_CONFIG');
  });

  it('permits an explicit nondefault port only when policy exactly authorizes it', async () => {
    const { tool, invoke } = setup();
    const configured = {
      ...tool,
      origin: `${origin}:8443`,
      invoke: async (req: ServiceRequest) => ({
        status: 200,
        origin: req.origin,
        redirected: false,
        data: { message: 'success', count: 1 },
      }),
    };
    const run = createAgentSecurity({ tools: [configured] }).run(scope);
    expect(() => run.bind(classic, policy)).toThrow('INVALID_POLICY');
    const reference = run.bind(classic, {
      grants: [{ toolId: tool.id, origin: configured.origin, fields: ['credential'] }],
    });
    expect((await run.execute(tool.id, { credential: reference })).ok).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    { status: 302, origin, redirected: false, code: 'REDIRECT_DENIED' },
    { status: 200, origin, redirected: true, code: 'REDIRECT_DENIED' },
    {
      status: 200,
      origin: 'https://service.example.test.evil.test',
      redirected: false,
      code: 'DESTINATION_DENIED',
    },
    {
      status: 200,
      origin: `${origin}:8443`,
      redirected: false,
      code: 'DESTINATION_DENIED',
    },
    { status: 200, origin: 'not a URL', redirected: false, code: 'DESTINATION_DENIED' },
  ])(
    'withholds responses from redirects or destination changes case %#',
    async (response) => {
      const { tool } = setup();
      const invoke = vi.fn(async () => ({
        ...response,
        data: { message: classic, count: 1 },
      }));
      const run = createAgentSecurity({ tools: [{ ...tool, invoke }] }).run(scope);
      const reference = run.bind(classic, policy);
      const result = await run.execute(tool.id, { credential: reference });
      expect(result.code).toBe(response.code);
      expect(Object.hasOwn(result, 'output')).toBe(false);
      expect(JSON.stringify(result).includes(classic)).toBe(false);
    },
  );
});

describe('safe results, errors and audit events', () => {
  it.each(['raw', 'encoded', 'base64', 'hex', 'reference'] as const)(
    'removes credential-bearing %s results',
    async (format) => {
      let reference = '';
      const forms = {
        raw: classic,
        encoded: encodeURIComponent(classic),
        base64: Buffer.from(classic).toString('base64'),
        hex: Buffer.from(classic).toString('hex'),
      };
      const { run, events } = setup({}, () => ({
        message: format === 'reference' ? reference : forms[format],
        count: 1,
        hidden: classic,
      }));
      reference = run.bind(classic, policy);
      const result = await run.execute('records.lookup', { credential: reference });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output.message).toBeNull();
        expect(Object.hasOwn(result.output, 'hidden')).toBe(false);
      }
      expect(JSON.stringify([result, events]).includes(classic)).toBe(false);
    },
  );

  it('also scrubs other registered secrets and detector matches', async () => {
    const { run } = setup({}, () => ({ message: fine, count: 1 }));
    const reference = run.bind(classic, policy);
    const result = await run.execute('records.lookup', { credential: reference });
    expect(result.ok && result.output.message === null).toBe(true);
  });

  it('scrubs the credential after concurrent revocation while an adapter is running', async () => {
    let finish!: () => void;
    const { tool } = setup();
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const run = createAgentSecurity({
      tools: [
        {
          ...tool,
          invoke: async () => {
            await gate;
            return {
              status: 200,
              origin,
              redirected: false,
              data: { message: classic, count: 1 },
            };
          },
        },
      ],
    }).run(scope);
    const reference = run.bind(classic, policy);
    const pending = run.execute(tool.id, { credential: reference });
    run.revoke(reference);
    finish();
    const result = await pending;
    expect(result.ok && result.output.message === null).toBe(true);
  });

  it.each(['error', 'security-error', 'string'] as const)(
    'does not forward adapter exception case %s',
    async (kind) => {
      const { tool } = setup();
      const run = createAgentSecurity({
        tools: [
          {
            ...tool,
            invoke: async () => {
              if (kind === 'string') throw classic;
              if (kind === 'security-error') {
                const error = new SecurityError('INVALID_ARGUMENTS');
                Object.assign(error, { code: classic });
                throw error;
              }
              throw new Error(classic);
            },
          },
        ],
      }).run(scope);
      const reference = run.bind(classic, policy);
      const result = await run.execute(tool.id, { credential: reference });
      expect(result.code).toBe('ADAPTER_FAILED');
      expect(JSON.stringify(result).includes(classic)).toBe(false);
    },
  );

  it('emits only the allowlisted audit schema', async () => {
    const { run, events } = setup();
    const reference = run.bind(classic, policy);
    await run.execute('records.lookup', {
      credential: reference,
      query: 'sensitive-untrusted-query',
    });
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]!).sort()).toEqual(
      ['operationId', 'toolId', 'outcome', 'code', 'bindingCount', 'durationMs'].sort(),
    );
    const text = JSON.stringify(events);
    expect(
      [
        classic,
        reference,
        origin,
        'sensitive-untrusted-query',
        scope.runId,
        scope.tenantId,
        scope.principalId,
      ].some((value) => text.includes(value)),
    ).toBe(false);
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(events[0]!.bindingCount).toBe(1);
  });

  it('reports failed audit delivery without re-executing the tool or echoing the exception', async () => {
    const { run, invoke } = setup({
      onAudit: async () => {
        throw new Error(classic);
      },
    });
    const reference = run.bind(classic, policy);
    const result = await run.execute('records.lookup', { credential: reference });
    expect(result.ok).toBe(true);
    expect(result.auditDelivered).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result).includes(classic)).toBe(false);
  });

  it.each([null, [], { count: Infinity, message: 'x' }, { count: 1, message: {} }])(
    'rejects invalid adapter output case %#',
    async (data) => {
      const { run } = setup({}, () => data);
      const result = await run.execute('records.lookup', {
        credential: run.bind(classic, policy),
      });
      expect(result.ok).toBe(false);
      expect(Object.hasOwn(result, 'output')).toBe(false);
    },
  );
});

describe('bounded atomic vault and failure behavior', () => {
  it('fails a batch atomically at capacity and keeps prior bindings usable', async () => {
    const { run, invoke } = setup({ vault: { maxEntries: 2 } });
    const existing = run.bind(classic, policy);
    expect(() => run.redact(`${classic} ${fine}`, policy)).toThrow('VAULT_CAPACITY');
    expect((await run.execute('records.lookup', { credential: existing })).ok).toBe(true);
    const second = run.bind(fine, policy);
    expect(second !== existing).toBe(true);
    expect(() => run.bind(fine, policy)).toThrow('VAULT_CAPACITY');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('bounds total value bytes and issued-reference tombstones', () => {
    const a = setup({ vault: { maxBytes: 4 } });
    expect(() => a.run.bind(classic, policy)).toThrow('VAULT_CAPACITY');
    const b = setup({ vault: { maxIssuedReferences: 1 } });
    const ref = b.run.bind(classic, policy);
    b.run.revoke(ref);
    expect(() => b.run.bind(fine, policy)).toThrow('VAULT_CAPACITY');
  });

  it.each([NaN, -1, 0, 1.5, Infinity])('rejects invalid limits case %#', (limit) => {
    expect(() => setup({ vault: { maxEntries: limit } })).toThrow('INVALID_CONFIG');
  });

  it('denies clock failures and clock rollback before invoking adapters', async () => {
    let now = 10;
    let broken = false;
    const { run, invoke } = setup({
      clock: () => {
        if (broken) throw new Error(classic);
        return now;
      },
    });
    const ref = run.bind(classic, policy);
    now = 9;
    expect((await run.execute('records.lookup', { credential: ref })).code).toBe(
      'VAULT_UNAVAILABLE',
    );
    broken = true;
    expect((await run.execute('records.lookup', { credential: ref })).code).toBe(
      'VAULT_UNAVAILABLE',
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('retries a collision, never overwrites, and keeps rejected batches atomic', () => {
    const entropy = vi
      .fn()
      .mockReturnValueOnce('a'.repeat(64))
      .mockReturnValueOnce('a'.repeat(64))
      .mockReturnValue('b'.repeat(64));
    const vault = new Vault({}, () => 0, entropy);
    const refs = vault.bindMany([classic, fine], scope, policy);
    expect(new Set(refs).size).toBe(2);
    expect(
      vault.authorize(refs[0]!, scope, 'records.lookup', origin, 'credential') ===
        classic,
    ).toBe(true);
    expect(
      vault.authorize(refs[1]!, scope, 'records.lookup', origin, 'credential') === fine,
    ).toBe(true);
    expect(() => vault.bindMany([fine], scope, policy)).toThrow('REFERENCE_COLLISION');
    vault.revoke(refs[0]!, scope);
    expect(() => vault.bindMany([fine], scope, policy)).toThrow('REFERENCE_COLLISION');
  });

  it('does not issue a reference already present in input text', () => {
    const entropy = vi
      .fn()
      .mockReturnValueOnce('a'.repeat(64))
      .mockReturnValue('b'.repeat(64));
    const vault = new Vault({}, () => 0, entropy);
    const literal = '[[APA_SECRET_' + 'a'.repeat(64) + ']]';
    const [ref] = vault.bindMany([classic], scope, policy, literal);
    expect(ref !== literal).toBe(true);
  });

  it('fails closed on entropy failure without retaining any partial batch', () => {
    let broken = true;
    const vault = new Vault(
      { maxEntries: 1 },
      () => 0,
      () => {
        if (broken) throw new Error(classic);
        return 'a'.repeat(64);
      },
    );
    expect(() => vault.bindMany([classic], scope, policy)).toThrow('VAULT_UNAVAILABLE');
    broken = false;
    expect(vault.bindMany([fine], scope, policy)).toHaveLength(1);
  });
});

describe('additional confidentiality boundaries', () => {
  it('redacts an explicitly registered value even when it has no detector signature', () => {
    const { run } = setup();
    const value = 'syntheticUnstructuredCredential987';
    run.bind(value, policy);
    const result = run.redact(`use ${value} here`, policy);
    expect(result.text.includes(value)).toBe(false);
    expect(result.count).toBe(1);
  });

  it('rejects malformed DNS labels in trusted origins', () => {
    const { tool } = setup();
    for (const origin of [
      'https://a..example.test',
      'https://-a.example.test',
      'https://a-.example.test',
    ]) {
      expect(() => createAgentSecurity({ tools: [{ ...tool, origin }] })).toThrow(
        'INVALID_CONFIG',
      );
    }
  });

  it('does not let duplicate tool registration replace the trusted adapter', () => {
    const { tool } = setup();
    expect(() => createAgentSecurity({ tools: [tool, tool] })).toThrow('INVALID_CONFIG');
  });
});

describe('bounded redaction input', () => {
  it('rejects oversized prompts before binding any credentials', () => {
    const { run } = setup({ vault: { maxEntries: 1 } });
    expect(() => run.redact('x'.repeat(65537), policy)).toThrow('INVALID_ARGUMENTS');
    expect(run.bind(classic, policy).length > 0).toBe(true);
  });
  it('bounds known-value candidate expansion atomically', () => {
    const { run } = setup();
    run.bind('x', policy);
    expect(() => run.redact('x'.repeat(5000), policy)).toThrow('INVALID_ARGUMENTS');
  });
});

describe('application-owned argument constraints', () => {
  it('rejects model-controlled values outside a trusted enum', async () => {
    const { tool, invoke } = setup();
    const values = ['status'];
    const run = createAgentSecurity({
      tools: [
        { ...tool, input: { ...tool.input, query: { type: 'string', enum: values } } },
      ],
    }).run(scope);
    values.push('delete');
    const reference = run.bind(classic, policy);
    const result = await run.execute(tool.id, { credential: reference, query: 'delete' });
    expect(result.code).toBe('INVALID_ARGUMENTS');
    expect(invoke).not.toHaveBeenCalled();
    expect(
      (await run.execute(tool.id, { credential: reference, query: 'status' })).ok,
    ).toBe(true);
  });
  it('rejects malformed enum schema configuration', () => {
    const { tool } = setup();
    expect(() =>
      createAgentSecurity({
        tools: [{ ...tool, input: { query: { type: 'number', enum: ['wrong-type'] } } }],
      }),
    ).toThrow('INVALID_CONFIG');
  });
});

describe('audit metadata canaries', () => {
  it('withholds audit metadata that happens to equal a registered secret', async () => {
    const { run, events } = setup();
    const reference = run.bind('records.lookup', policy);
    const result = await run.execute('records.lookup', { credential: reference });
    expect(result.ok).toBe(true);
    expect(result.auditDelivered).toBe(false);
    expect(events).toHaveLength(0);
  });
});
