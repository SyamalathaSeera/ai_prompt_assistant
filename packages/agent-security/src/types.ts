export interface Scope {
  readonly tenantId: string;
  readonly principalId: string;
  readonly runId: string;
}

export interface BindingPolicy {
  readonly grants: readonly {
    readonly toolId: string;
    readonly origin: string;
    readonly fields: readonly string[];
  }[];
}

export interface FieldSchema {
  readonly type: 'string' | 'number' | 'boolean';
  readonly required?: boolean;
  /** Input only: credentials must be whole opaque references in these fields. */
  readonly secret?: boolean;
  readonly maxLength?: number;
  readonly enum?: readonly Scalar[];
}
export type Schema = Readonly<Record<string, FieldSchema>>;
export type Scalar = string | number | boolean;
export type SafeOutput = Readonly<Record<string, Scalar | null>>;

export interface ServiceRequest {
  readonly origin: string;
  readonly redirect: 'error';
  readonly arguments: Readonly<Record<string, Scalar>>;
}

/** Trusted adapters must contact only request.origin and reject redirects before following. */
export interface FixedServiceTool {
  readonly id: string;
  readonly origin: string;
  readonly input: Schema;
  readonly output: Schema;
  readonly invoke: (request: ServiceRequest) => Promise<{
    status: number;
    origin: string;
    redirected: boolean;
    data: unknown;
  }>;
}

export type ReasonCode =
  | 'OK'
  | 'INVALID_CONFIG'
  | 'INVALID_SCOPE'
  | 'INVALID_POLICY'
  | 'INVALID_ARGUMENTS'
  | 'INVALID_REFERENCE'
  | 'REFERENCE_DENIED'
  | 'FIELD_DENIED'
  | 'POLICY_DENIED'
  | 'DESTINATION_DENIED'
  | 'REDIRECT_DENIED'
  | 'UNKNOWN_TOOL'
  | 'RAW_SECRET'
  | 'VAULT_CAPACITY'
  | 'VAULT_UNAVAILABLE'
  | 'REFERENCE_COLLISION'
  | 'RUN_CLOSED'
  | 'ADAPTER_FAILED'
  | 'INVALID_OUTPUT';

export interface AuditEvent {
  readonly operationId: string;
  readonly toolId: string;
  readonly outcome: 'allowed' | 'denied' | 'failed';
  readonly code: ReasonCode;
  readonly bindingCount: number;
  readonly durationMs: number;
}

export type ExecutionResult = (
  | { readonly ok: true; readonly code: 'OK'; readonly output: SafeOutput }
  | { readonly ok: false; readonly code: Exclude<ReasonCode, 'OK'> }
) & { readonly operationId: string; readonly auditDelivered: boolean };

export interface VaultLimits {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly maxIssuedReferences?: number;
  readonly ttlMs?: number;
}

export interface CoreOptions {
  readonly tools: readonly FixedServiceTool[];
  readonly vault?: VaultLimits;
  /** Trusted monotonic clock; defaults to Node's performance.now. */
  readonly clock?: () => number;
  readonly onAudit?: (event: AuditEvent) => void | Promise<void>;
}

export interface SecurityRun {
  bind(secret: string, policy: BindingPolicy): string;
  redact(
    text: string,
    policy: BindingPolicy,
  ): Readonly<{ text: string; references: readonly string[]; count: number }>;
  revoke(reference: string): void;
  execute(toolId: string, arguments_: unknown): Promise<ExecutionResult>;
  dispose(): void;
}

export interface AgentSecurity {
  /** Call from trusted application code; never derive scope from model arguments. */
  run(scope: Scope): SecurityRun;
}
