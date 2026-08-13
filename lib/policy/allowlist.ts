import type { Finding } from '../detector/types';

/**
 * Allowlist: values the user has told us never to flag again.
 *
 * Deliberately NOT part of `lib/detector/`. Hashing needs `crypto.subtle`,
 * which is asynchronous and is a platform API — importing it into the detector
 * would break ADR-004 and make the corpus suite untestable in a plain Node
 * environment. The detector stays pure; suppression happens here, around it.
 *
 * Entries are stored as SHA-256 hex digests. The plaintext never touches
 * storage, so the allowlist cannot itself become a place secrets accumulate —
 * which is the failure mode this whole product exists to prevent. The
 * consequence is that the options UI can list entries and delete them but can
 * never display them; that is the correct trade and the UI says so.
 */

/** SHA-256 hex digest of a value. */
export async function hashValue(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Removes findings whose value the user has allowlisted.
 *
 * Runs after `detect()` rather than inside it. Hashing every candidate during
 * the scan would put an async boundary on the hot path that the live risk
 * badge depends on; findings are few, so hashing them afterwards is cheaper
 * and keeps the detector synchronous.
 */
export async function filterAllowlisted(
  text: string,
  findings: readonly Finding[],
  allowlistHashes: readonly string[],
): Promise<Finding[]> {
  if (allowlistHashes.length === 0 || findings.length === 0) return [...findings];

  const allowed = new Set(allowlistHashes);

  // Distinct values only — the same secret often appears several times.
  const values = [...new Set(findings.map((f) => text.slice(f.start, f.end)))];
  const suppressed = new Set<string>();

  await Promise.all(
    values.map(async (value) => {
      if (allowed.has(await hashValue(value))) suppressed.add(value);
    }),
  );

  return findings.filter((f) => !suppressed.has(text.slice(f.start, f.end)));
}

/** Adds a value to the allowlist, returning the updated hash list. */
export async function addToAllowlist(
  value: string,
  allowlistHashes: readonly string[],
): Promise<string[]> {
  const hash = await hashValue(value);
  return allowlistHashes.includes(hash) ? [...allowlistHashes] : [...allowlistHashes, hash];
}

/** Whether a value is already allowlisted. */
export async function isAllowlisted(
  value: string,
  allowlistHashes: readonly string[],
): Promise<boolean> {
  return allowlistHashes.includes(await hashValue(value));
}
