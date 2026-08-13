import { cloudRules } from './cloud';
import { connectionStringRules } from './connection-strings';
import { cryptoMaterialRules } from './crypto-material';
import { envAssignmentRules } from './env-assignments';
import { financialRules } from './financial';
import { jwtRules } from './jwt';
import { piiRules } from './pii';
import { vendorRules } from './vendor';
import type { Rule } from '../types';

export { DEFAULT_DISABLED_RULE_IDS } from './pii';

/**
 * The rule registry.
 *
 * One file per family, registered here. Adding a rule means adding a file and
 * one entry — the engine never changes.
 *
 * High-tier rules are anchored on a vendor prefix, an armoured header, or a
 * keyword, such that firing on innocent text would be a bug rather than a
 * judgement call. They block submission, so the bar is precision, not
 * coverage.
 *
 * Low-tier rules (soft PII) only ever suggest. Some ship disabled — see
 * `DEFAULT_DISABLED_RULE_IDS`.
 */
export const ALL_RULES: readonly Rule[] = [
  ...cloudRules,
  ...vendorRules,
  ...cryptoMaterialRules,
  ...connectionStringRules,
  ...envAssignmentRules,
  ...financialRules,
  ...jwtRules,
  ...piiRules,
];
