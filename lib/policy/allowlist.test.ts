import { describe, expect, it } from 'vitest';
import { detect } from '../detector/engine';
import { ALL_RULES } from '../detector/rules';
import {
  addToAllowlist,
  filterAllowlisted,
  hashValue,
  isAllowlisted,
  removeFromAllowlist,
} from './allowlist';
import type { AllowlistEntry } from './schema';

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';

describe('hashValue', () => {
  it('is deterministic', async () => {
    expect(await hashValue('hello')).toBe(await hashValue('hello'));
  });

  it('produces a SHA-256 hex digest', async () => {
    const hash = await hashValue('hello');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Published SHA-256 of "hello".
    expect(hash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('separates values that differ by one character', async () => {
    expect(await hashValue(AWS_KEY)).not.toBe(await hashValue(`${AWS_KEY}x`));
  });

  it('never returns the plaintext', async () => {
    expect(await hashValue(AWS_KEY)).not.toContain(AWS_KEY);
  });
});

describe('addToAllowlist', () => {
  it('stores a hash, never the value', async () => {
    const list = await addToAllowlist(AWS_KEY, [], 'AWS Access Key ID', '2026-08-13');
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(AWS_KEY);
  });

  it('is idempotent', async () => {
    const once = await addToAllowlist(AWS_KEY, [], 'AWS Access Key ID', '2026-08-13');
    const twice = await addToAllowlist(AWS_KEY, once, 'AWS Access Key ID', '2026-08-13');
    expect(twice).toEqual(once);
  });

  it('does not mutate the list it was given', async () => {
    const original: AllowlistEntry[] = [];
    await addToAllowlist(AWS_KEY, original, 'AWS Access Key ID', '2026-08-13');
    expect(original).toEqual([]);
  });

  it('records the rule label and date, never the value', async () => {
    // Enough to recognise an entry in a list, without the list becoming a
    // place secrets accumulate.
    const [entry] = await addToAllowlist(AWS_KEY, [], 'AWS Access Key ID', '2026-08-13');

    expect(entry!.label).toBe('AWS Access Key ID');
    expect(entry!.addedAt).toBe('2026-08-13');
    expect(entry!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(entry)).not.toContain(AWS_KEY);
  });
});

describe('removeFromAllowlist', () => {
  it('removes by hash', async () => {
    const list = await addToAllowlist(AWS_KEY, [], 'AWS Access Key ID', '2026-08-13');
    expect(removeFromAllowlist(list[0]!.hash, list)).toEqual([]);
  });

  it('leaves other entries alone', async () => {
    let list = await addToAllowlist(AWS_KEY, [], 'AWS Access Key ID', '2026-08-13');
    list = await addToAllowlist('other-secret', list, 'Stripe Live Key', '2026-08-13');

    const remaining = removeFromAllowlist(list[0]!.hash, list);

    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.label).toBe('Stripe Live Key');
  });

  it('is a no-op for an unknown hash', async () => {
    const list = await addToAllowlist(AWS_KEY, [], 'AWS Access Key ID', '2026-08-13');
    expect(removeFromAllowlist('nope', list)).toEqual(list);
  });
});

describe('isAllowlisted', () => {
  it('recognises a stored value', async () => {
    const list = await addToAllowlist(AWS_KEY, [], 'AWS Access Key ID', '2026-08-13');
    expect(await isAllowlisted(AWS_KEY, list)).toBe(true);
  });

  it('rejects an unknown value', async () => {
    const list = await addToAllowlist(AWS_KEY, [], 'AWS Access Key ID', '2026-08-13');
    expect(await isAllowlisted('AKIAIOSFODNN7EXAMPLE', list)).toBe(false);
  });
});

describe('filterAllowlisted', () => {
  const text = `AWS_ACCESS_KEY_ID=${AWS_KEY}\nSTRIPE_SECRET_KEY=sk_live_9mQ4vX2nR7tK1pL5wZ8yB3cF`;

  it('removes only the allowlisted finding', async () => {
    const findings = detect(text, {}, ALL_RULES);
    const list = await addToAllowlist(AWS_KEY, [], 'AWS Access Key ID', '2026-08-13');
    const filtered = await filterAllowlisted(text, findings, list);

    expect(findings.length).toBeGreaterThan(filtered.length);
    expect(filtered.some((f) => text.slice(f.start, f.end) === AWS_KEY)).toBe(false);
    expect(filtered.some((f) => f.ruleId === 'stripe.live_key')).toBe(true);
  });

  it('removes every occurrence of an allowlisted value', async () => {
    const repeated = `a=${AWS_KEY}\nb=${AWS_KEY}\nc=${AWS_KEY}`;
    const findings = detect(repeated, {}, ALL_RULES);
    const list = await addToAllowlist(AWS_KEY, [], 'AWS Access Key ID', '2026-08-13');

    expect(findings.length).toBeGreaterThan(1);
    expect(await filterAllowlisted(repeated, findings, list)).toEqual([]);
  });

  it('is a no-op when the allowlist is empty', async () => {
    const findings = detect(text, {}, ALL_RULES);
    expect(await filterAllowlisted(text, findings, [])).toEqual(findings);
  });

  it('is a no-op when there are no findings', async () => {
    const list = await addToAllowlist(AWS_KEY, [], 'AWS Access Key ID', '2026-08-13');
    expect(await filterAllowlisted(text, [], list)).toEqual([]);
  });
});

describe('architectural boundary', () => {
  it('keeps hashing out of the detector', async () => {
    // crypto.subtle is async and a platform API. Importing it into
    // lib/detector/ would break ADR-004 and make the corpus suite untestable
    // without a browser. Suppression therefore happens around the detector,
    // never inside it — detect() stays synchronous and pure.
    const findings = detect(`key=${AWS_KEY}`, {}, ALL_RULES);
    expect(Array.isArray(findings)).toBe(true);

    const list = await addToAllowlist(AWS_KEY, [], 'AWS Access Key ID', '2026-08-13');
    expect(list[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
