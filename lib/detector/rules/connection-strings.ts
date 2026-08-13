import { defineRule } from './shared';
import type { Rule } from '../types';

/**
 * Database and broker connection strings that carry credentials.
 *
 * The rule requires the `user:password@` form. A connection string without
 * credentials is a hostname, not a secret, and flagging one would be noise.
 */

/**
 * Only the password is captured, so the redaction keeps the scheme, user, and
 * host visible: `postgres://app:[REDACTED_DB_PASSWORD_1]@db.internal/orders`
 * still tells the model what the task is about.
 */
export const connectionStringPassword = defineRule({
  id: 'db.connection_string_password',
  label: 'Database Connection Password',
  description: 'Passwords inside database URLs such as postgres:// or mongodb://',
  token: 'DB_PASSWORD',
  pattern:
    /\b(?:postgres|postgresql|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|ftp|sftp|jdbc:[a-z0-9]+):\/\/[^\s:/@]+:([^\s@/]{3,})@[^\s/]+/gi,
  captureGroup: 1,
});

export const connectionStringRules: readonly Rule[] = [connectionStringPassword];
