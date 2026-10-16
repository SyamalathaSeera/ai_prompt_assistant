import type { BindingPolicy, FixedServiceTool } from './types';
import { exactKeys, fail, httpsOrigin, record } from './safety';

/** Copy into private immutable grants before any asynchronous work. */
export function freezePolicy(
  input: BindingPolicy,
  tools: ReadonlyMap<string, FixedServiceTool>,
): BindingPolicy {
  try {
    const data = record(input);
    exactKeys(data, ['grants']);
    if (!Array.isArray(data.grants) || data.grants.length > 64) fail('INVALID_POLICY');
    const grants = data.grants.map((raw: unknown) => {
      const grant = record(raw);
      exactKeys(grant, ['toolId', 'origin', 'fields']);
      const tool = typeof grant.toolId === 'string' ? tools.get(grant.toolId) : undefined;
      const origin = httpsOrigin(grant.origin);
      if (
        !tool ||
        origin !== tool.origin ||
        !Array.isArray(grant.fields) ||
        grant.fields.length > 64 ||
        !grant.fields.every(
          (field: unknown) =>
            typeof field === 'string' && tool.input[field]?.secret === true,
        )
      )
        fail('INVALID_POLICY');
      return Object.freeze({
        toolId: tool.id,
        origin,
        fields: Object.freeze([...new Set(grant.fields as string[])]),
      });
    });
    return Object.freeze({ grants: Object.freeze(grants) });
  } catch {
    return fail('INVALID_POLICY');
  }
}
