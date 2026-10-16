import { describe, expect, it } from 'vitest';
import { detect, detectAndRedact, formatPlaceholder, redact } from './engine';
import type { Rule } from './types';
import { githubToken, githubFineGrainedToken } from './rules/vendor';

/**
 * Engine tests.
 *
 * Rules are injected rather than taken from the registry, so these stay true
 * regardless of which detection rules exist. They pin the engine's contract:
 * deterministic overlap resolution, stable placeholder numbering, and never
 * throwing on hostile input.
 */

function rule(over: Partial<Rule> & Pick<Rule, 'id' | 'pattern'>): Rule {
  return {
    label: over.label ?? over.id,
    tier: over.tier ?? 'high',
    token: over.token ?? over.id.toUpperCase(),
    ...over,
  };
}

const AWS = rule({ id: 'aws', pattern: /AKIA[0-9A-Z]{16}/g, label: 'AWS Key' });
const WORD = rule({ id: 'word', pattern: /\bsecret\b/g, tier: 'low' });

describe('detect() basics', () => {
  it('returns nothing for empty input', () => {
    expect(detect('', {}, [AWS])).toEqual([]);
  });

  it('returns nothing when no rules are registered', () => {
    expect(detect('AKIAIOSFODNN7EXAMPLE', {}, [])).toEqual([]);
  });

  it('returns nothing when the text is clean', () => {
    expect(detect('just some ordinary prose', {}, [AWS])).toEqual([]);
  });

  it('finds a match and reports offsets that slice back to the value', () => {
    const text = 'key is AKIAIOSFODNN7EXAMPLE ok';
    const [found] = detect(text, {}, [AWS]);

    expect(found).toBeDefined();
    expect(found!.ruleId).toBe('aws');
    expect(found!.tier).toBe('high');
    expect(text.slice(found!.start, found!.end)).toBe('AKIAIOSFODNN7EXAMPLE');
  });

  it('never puts the matched value on the Finding', () => {
    const found = detect('AKIAIOSFODNN7EXAMPLE', {}, [AWS]);
    const serialized = JSON.stringify(found);
    expect(serialized).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('returns findings in reading order', () => {
    const text = 'secret AKIAIOSFODNN7EXAMPLE secret';
    const found = detect(text, {}, [AWS, WORD]);
    const starts = found.map((f) => f.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe('placeholder numbering', () => {
  it('gives the same value one placeholder however often it appears', () => {
    const key = 'AKIAIOSFODNN7EXAMPLE';
    const found = detect(`${key} then ${key} then ${key}`, {}, [AWS]);

    expect(found).toHaveLength(3);
    expect(new Set(found.map((f) => f.placeholder)).size).toBe(1);
    expect(found[0]!.placeholder).toBe('[REDACTED_AWS_1]');
  });

  it('numbers distinct values incrementally', () => {
    const found = detect('AKIAIOSFODNN7EXAMPLE and AKIAJJJJJJJJJJJJJJJJ', {}, [AWS]);
    expect(found.map((f) => f.placeholder)).toEqual([
      '[REDACTED_AWS_1]',
      '[REDACTED_AWS_2]',
    ]);
  });

  it('numbers each rule independently', () => {
    const found = detect('AKIAIOSFODNN7EXAMPLE secret', {}, [AWS, WORD]);
    expect(found.map((f) => f.placeholder)).toEqual([
      '[REDACTED_AWS_1]',
      '[REDACTED_WORD_1]',
    ]);
  });
});

describe('overlap resolution', () => {
  const text = 'AKIAIOSFODNN7EXAMPLE';

  // Ids are chosen so each test distinguishes exactly one precedence rule.
  // `wide` sorts LAST alphabetically, so if the length comparison were broken
  // and precedence fell through to the id, `narrow` would win instead — the
  // test would fail rather than pass for the wrong reason.
  const wide = rule({ id: 'z-wide', pattern: /AKIA[0-9A-Z]{16}/g, tier: 'low' });
  const narrow = rule({ id: 'a-narrow', pattern: /AKIA[0-9A-Z]{8}/g, tier: 'low' });
  // Likewise sorts last, so a broken tier comparison surfaces as a failure.
  const highNarrow = rule({ id: 'z-high', pattern: /AKIA[0-9A-Z]{8}/g, tier: 'high' });

  it('prefers the high tier even when the low-tier match is longer', () => {
    const found = detect(text, {}, [wide, highNarrow]);
    expect(found).toHaveLength(1);
    expect(found[0]!.ruleId).toBe('z-high');
  });

  it('prefers the longer span within the same tier', () => {
    const found = detect(text, {}, [wide, narrow]);
    expect(found).toHaveLength(1);
    expect(found[0]!.ruleId).toBe('z-wide');
  });

  it('breaks a genuine tie on the lexicographically earlier rule id', () => {
    const first = rule({ id: 'aaa', pattern: /AKIA[0-9A-Z]{16}/g, tier: 'low' });
    const second = rule({ id: 'zzz', pattern: /AKIA[0-9A-Z]{16}/g, tier: 'low' });
    const found = detect(text, {}, [second, first]);

    expect(found).toHaveLength(1);
    expect(found[0]!.ruleId).toBe('aaa');
  });

  it('is independent of the order rules are supplied in', () => {
    const forward = detect(text, {}, [wide, narrow, highNarrow]);
    const reverse = detect(text, {}, [highNarrow, narrow, wide]);
    expect(forward).toEqual(reverse);
  });

  it('keeps non-overlapping matches from different rules', () => {
    const found = detect('AKIAIOSFODNN7EXAMPLE and a secret', {}, [AWS, WORD]);
    expect(found.map((f) => f.ruleId)).toEqual(['aws', 'word']);
  });
});

describe('options', () => {
  it('skips disabled rules', () => {
    const found = detect('AKIAIOSFODNN7EXAMPLE secret', { disabledRuleIds: ['aws'] }, [
      AWS,
      WORD,
    ]);
    expect(found.map((f) => f.ruleId)).toEqual(['word']);
  });

  it('suppresses allowlisted values', () => {
    const found = detect(
      'AKIAIOSFODNN7EXAMPLE',
      { isAllowlisted: (v) => v === 'AKIAIOSFODNN7EXAMPLE' },
      [AWS],
    );
    expect(found).toEqual([]);
  });

  it('keeps the finding when the allowlist predicate throws', () => {
    const found = detect(
      'AKIAIOSFODNN7EXAMPLE',
      {
        isAllowlisted: () => {
          throw new Error('boom');
        },
      },
      [AWS],
    );
    expect(found).toHaveLength(1);
  });
});

describe('validators', () => {
  it('drops matches the validator rejects', () => {
    const gated = rule({ id: 'aws', pattern: /AKIA[0-9A-Z]{16}/g, validate: () => false });
    expect(detect('AKIAIOSFODNN7EXAMPLE', {}, [gated])).toEqual([]);
  });

  it('passes the surrounding text and offsets to the validator', () => {
    let seen: { text: string; start: number; end: number } | null = null;
    const spy = rule({
      id: 'aws',
      pattern: /AKIA[0-9A-Z]{16}/g,
      validate: (_m, ctx) => {
        seen = { text: ctx.text, start: ctx.start, end: ctx.end };
        return true;
      },
    });

    const text = 'xx AKIAIOSFODNN7EXAMPLE';
    detect(text, {}, [spy]);

    expect(seen).not.toBeNull();
    expect(seen!.text).toBe(text);
    expect(text.slice(seen!.start, seen!.end)).toBe('AKIAIOSFODNN7EXAMPLE');
  });

  it('keeps the match when a validator throws, rather than silently dropping it', () => {
    // A leak is worse than a false positive, so an unexpected validator failure
    // must surface the candidate rather than swallow it.
    const broken = rule({
      id: 'aws',
      pattern: /AKIA[0-9A-Z]{16}/g,
      validate: () => {
        throw new Error('boom');
      },
    });
    expect(detect('AKIAIOSFODNN7EXAMPLE', {}, [broken])).toHaveLength(1);
  });
});

describe('placeholder style', () => {
  it('defaults to the bracketed form', () => {
    expect(formatPlaceholder('AWS_KEY', 1)).toBe('[REDACTED_AWS_KEY_1]');
  });

  it('renders the dummy form when asked', () => {
    expect(formatPlaceholder('AWS_KEY', 2, 'dummy')).toBe('dummy_aws_key_2');
  });

  it('threads the style through detection', () => {
    const found = detect('AKIAIOSFODNN7EXAMPLE', { placeholderStyle: 'dummy' }, [AWS]);
    expect(found[0]!.placeholder).toBe('dummy_aws_1');
  });
});

describe('redact()', () => {
  const text = 'key AKIAIOSFODNN7EXAMPLE and secret here';

  it('substitutes placeholders and returns the value map', () => {
    const findings = detect(text, {}, [AWS, WORD]);
    const { text: out, map } = redact(text, findings);

    expect(out).toBe('key [REDACTED_AWS_1] and [REDACTED_WORD_1] here');
    expect(map['[REDACTED_AWS_1]']).toBe('AKIAIOSFODNN7EXAMPLE');
    expect(map['[REDACTED_WORD_1]']).toBe('secret');
  });

  it('applies right to left so later offsets stay valid', () => {
    // A left-to-right implementation corrupts every offset after the first
    // substitution whenever the placeholder differs in length from the value.
    const many = 'AKIAIOSFODNN7EXAMPLE AKIAJJJJJJJJJJJJJJJJ AKIAKKKKKKKKKKKKKKKK';
    const { text: out } = redact(many, detect(many, {}, [AWS]));

    expect(out).toBe(
      '[REDACTED_AWS_1] [REDACTED_AWS_2] [REDACTED_AWS_3]',
    );
  });

  it('maps repeated values to one placeholder', () => {
    const repeated = 'AKIAIOSFODNN7EXAMPLE then AKIAIOSFODNN7EXAMPLE';
    const { text: out, map } = redact(repeated, detect(repeated, {}, [AWS]));

    expect(out).toBe('[REDACTED_AWS_1] then [REDACTED_AWS_1]');
    expect(Object.keys(map)).toHaveLength(1);
  });

  it('returns the input unchanged when there is nothing to redact', () => {
    const { text: out, map } = redact('nothing here', []);
    expect(out).toBe('nothing here');
    expect(map).toEqual({});
  });

  it('prefers the wider span when findings overlap', () => {
    // detect() resolves overlaps, so this only guards hand-assembled input.
    // Redacting the inner span would leave the outer value's surrounding
    // characters exposed — a partial leak.
    const findings = [
      { ruleId: 'a', label: 'a', tier: 'high' as const, start: 4, end: 24, placeholder: '[A]' },
      { ruleId: 'b', label: 'b', tier: 'high' as const, start: 8, end: 16, placeholder: '[B]' },
    ];
    const { text: out } = redact(text, findings);

    expect(out).toBe('key [A] and secret here');
  });

  it('never emits a placeholder that would be re-detected', () => {
    const { text: out } = redact(text, detect(text, {}, [AWS, WORD]));
    expect(detect(out, {}, [AWS, WORD])).toEqual([]);
  });
});

describe('detectAndRedact()', () => {
  it('returns findings alongside the redacted text', () => {
    const text = 'key AKIAIOSFODNN7EXAMPLE';
    const result = detectAndRedact(text, {}, [AWS]);

    expect(result.findings).toHaveLength(1);
    expect(result.text).toBe('key [REDACTED_AWS_1]');
    expect(result.map['[REDACTED_AWS_1]']).toBe('AKIAIOSFODNN7EXAMPLE');
  });
});

describe('robustness', () => {
  it('reports correct offsets across astral-plane characters', () => {
    const text = '🔑🔑 AKIAIOSFODNN7EXAMPLE';
    const [found] = detect(text, {}, [AWS]);
    expect(text.slice(found!.start, found!.end)).toBe('AKIAIOSFODNN7EXAMPLE');
  });

  it('handles a non-global pattern without losing matches', () => {
    const nonGlobal = rule({ id: 'aws', pattern: /AKIA[0-9A-Z]{16}/ });
    const key = 'AKIAIOSFODNN7EXAMPLE';
    expect(detect(`${key} ${key}`, {}, [nonGlobal])).toHaveLength(2);
  });

  it('does not leak regex lastIndex between calls', () => {
    const shared = rule({ id: 'aws', pattern: /AKIA[0-9A-Z]{16}/g });
    const text = 'AKIAIOSFODNN7EXAMPLE';
    expect(detect(text, {}, [shared])).toHaveLength(1);
    expect(detect(text, {}, [shared])).toHaveLength(1);
    expect(detect(text, {}, [shared])).toHaveLength(1);
  });

  it('ignores zero-length matches instead of emitting empty findings', () => {
    const empty = rule({ id: 'empty', pattern: /(?:)/g });
    expect(detect('abc', {}, [empty])).toEqual([]);
  });

  it('survives a large input', () => {
    const text = `${'lorem ipsum '.repeat(20_000)}AKIAIOSFODNN7EXAMPLE`;
    const found = detect(text, {}, [AWS, WORD]);
    expect(found).toHaveLength(1);
  });

  it('handles text that is only whitespace or punctuation', () => {
    expect(detect('   \n\t  ---  ', {}, [AWS, WORD])).toEqual([]);
  });
});


describe('shared placeholder labels', () => {
  it.each(['bracketed', 'dummy'] as const)('keeps mixed GitHub values distinct with %s placeholders', (placeholderStyle) => {
    const classic = 'ghp_' + 'Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1St2Uv3Wx4';
    const fine = 'github_pat_' + 'Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1St2Uv3Wx4Yz5'.repeat(2);
    const text = `${classic} ${fine} ${classic}`;
    const findings = detect(text, { placeholderStyle }, [githubToken, githubFineGrainedToken]);
    expect(findings).toHaveLength(3);
    expect(new Set(findings.map((f) => f.placeholder)).size).toBe(2);
    const result = redact(text, findings);
    expect(Object.keys(result.map)).toHaveLength(2);
    expect(findings.every((f) => result.map[f.placeholder] === text.slice(f.start, f.end))).toBe(true);
  });
});
