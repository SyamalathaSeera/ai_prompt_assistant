import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { BindingPolicy, Scope, VaultLimits } from './types';
import { fail, REFERENCE } from './safety';

interface Entry {
  readonly value: string;
  readonly scope: Scope;
  readonly policy: BindingPolicy;
  readonly expiresAt: number;
  readonly bytes: number;
}

function sameScope(a: Scope, b: Scope): boolean {
  return (
    a.tenantId === b.tenantId && a.principalId === b.principalId && a.runId === b.runId
  );
}

/** Internal only: synchronous operations are atomic within this JS isolate. */
export class Vault {
  #entries = new Map<string, Entry>();
  #issued = new Set<string>();
  #bytes = 0;
  #lastTime = -Infinity;
  #limits: Required<VaultLimits>;
  constructor(
    limits: VaultLimits,
    private readonly clock: () => number,
    private readonly entropy = () => randomBytes(32).toString('hex'),
  ) {
    this.#limits = {
      maxEntries: limits.maxEntries ?? 200,
      maxBytes: limits.maxBytes ?? 1024 * 1024,
      maxIssuedReferences: limits.maxIssuedReferences ?? 10000,
      ttlMs: limits.ttlMs ?? 300000,
    };
    for (const [key, value] of Object.entries(this.#limits)) {
      if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value >
          (key === 'maxBytes' ? 16 * 1024 * 1024 : key === 'ttlMs' ? 3600000 : 100000)
      )
        fail('INVALID_CONFIG');
    }
  }
  #now(): number {
    let now: number;
    try {
      now = this.clock();
    } catch {
      return fail('VAULT_UNAVAILABLE');
    }
    if (!Number.isFinite(now) || now < this.#lastTime) fail('VAULT_UNAVAILABLE');
    this.#lastTime = now;
    return now;
  }
  #remove(reference: string): void {
    const entry = this.#entries.get(reference);
    if (entry) {
      this.#bytes -= entry.bytes;
      this.#entries.delete(reference);
    }
  }
  #sweep(now: number): void {
    for (const [reference, entry] of this.#entries)
      if (entry.expiresAt <= now) this.#remove(reference);
  }
  assertAvailable(): void {
    this.#sweep(this.#now());
  }
  bindMany(
    values: readonly string[],
    scope: Scope,
    policy: BindingPolicy,
    source = '',
  ): readonly string[] {
    const now = this.#now();
    this.#sweep(now);
    if (
      values.some(
        (value) =>
          typeof value !== 'string' || value.length === 0 || value.length > 65536,
      )
    )
      fail('INVALID_ARGUMENTS');
    const bytes = values.reduce(
      (sum, value) => sum + Buffer.byteLength(value, 'utf8'),
      0,
    );
    if (
      this.#entries.size + values.length > this.#limits.maxEntries ||
      this.#bytes + bytes > this.#limits.maxBytes ||
      this.#issued.size + values.length > this.#limits.maxIssuedReferences
    )
      fail('VAULT_CAPACITY');
    const pending = new Map<string, Entry>();
    for (const value of values) {
      let reference = '';
      for (let attempt = 0; attempt < 8; attempt++) {
        let random: string;
        try {
          random = this.entropy();
        } catch {
          return fail('VAULT_UNAVAILABLE');
        }
        if (!/^[a-f0-9]{64}$/.test(random)) fail('VAULT_UNAVAILABLE');
        const candidate = `[[APA_SECRET_${random}]]`;
        if (
          !this.#issued.has(candidate) &&
          !pending.has(candidate) &&
          !source.includes(candidate)
        ) {
          reference = candidate;
          break;
        }
      }
      if (!reference) fail('REFERENCE_COLLISION');
      pending.set(reference, {
        value,
        scope,
        policy,
        expiresAt: now + this.#limits.ttlMs,
        bytes: Buffer.byteLength(value, 'utf8'),
      });
    }
    // No await or callbacks inside the commit; partial batches never become visible.
    for (const [reference, entry] of pending) {
      this.#entries.set(reference, entry);
      this.#issued.add(reference);
      this.#bytes += entry.bytes;
    }
    return Object.freeze([...pending.keys()]);
  }
  authorize(
    reference: string,
    scope: Scope,
    toolId: string,
    origin: string,
    field: string,
  ): string {
    if (!REFERENCE.test(reference)) fail('INVALID_REFERENCE');
    const now = this.#now();
    const entry = this.#entries.get(reference);
    if (!entry || entry.expiresAt <= now || !sameScope(scope, entry.scope)) {
      this.#sweep(now);
      return fail('REFERENCE_DENIED');
    }
    if (
      !entry.policy.grants.some(
        (grant) =>
          grant.toolId === toolId &&
          grant.origin === origin &&
          grant.fields.includes(field),
      )
    )
      fail('POLICY_DENIED');
    return entry.value;
  }
  revoke(reference: string, scope: Scope): void {
    this.#now();
    const entry = this.#entries.get(reference);
    if (!entry || !sameScope(scope, entry.scope)) fail('REFERENCE_DENIED');
    this.#remove(reference);
  }
  dispose(scope: Scope): void {
    for (const [reference, entry] of this.#entries)
      if (sameScope(scope, entry.scope)) this.#remove(reference);
  }
  /** Used only for egress checks, never exported through the package API. */
  sensitiveValues(): readonly string[] {
    return [...this.#entries.values()].map((entry) => entry.value);
  }
}
