import { describe, expect, it } from 'vitest';
import { anchorVariety, findVagueReferences, maskCode } from './references';

const kinds = (draft: string) => findVagueReferences(draft).map((r) => r.kind);
const texts = (draft: string) =>
  findVagueReferences(draft).map((r) => r.text.toLowerCase());

describe('masking code before scanning', () => {
  it('blanks fenced blocks without moving any offset', () => {
    const draft = 'Look at\n```\nif (this) that\n```\nand fix it';
    const masked = maskCode(draft);

    expect(masked).toHaveLength(draft.length);
    expect(masked).not.toContain('this');
    // Newlines survive, so line numbers still line up.
    expect(masked.split('\n')).toHaveLength(draft.split('\n').length);
  });

  it('blanks inline spans', () => {
    expect(maskCode('use `this.foo` here')).not.toContain('this');
  });

  it('leaves prose alone', () => {
    expect(maskCode('fix this please')).toBe('fix this please');
  });

  it('does not treat a keyword inside code as the user pointing at anything', () => {
    // Without masking, every JavaScript snippet would fire the feature.
    expect(findVagueReferences('```js\nreturn this.value;\n```')).toEqual([]);
  });
});

describe('demonstratives', () => {
  it('fires on a bare demonstrative', () => {
    expect(kinds('add this')).toContain('demonstrative');
  });

  it('stays silent when the demonstrative names its own subject', () => {
    // "this file" says what it means; there is nothing to resolve.
    expect(findVagueReferences('rewrite this function')).toEqual([]);
    expect(findVagueReferences('update that config value')).toEqual([]);
  });

  it('reads a demonstrative followed by a verb as standing alone', () => {
    expect(kinds('this is broken')).toContain('demonstrative');
  });

  it('reads a demonstrative followed by a comparative as standing alone', () => {
    expect(kinds('make this cleaner')).toContain('demonstrative');
  });

  it('treats a noun ending in -er as a noun, not a comparative', () => {
    /*
     * The reason PRONOUN_FOLLOWERS is a closed list rather than a suffix rule.
     * "update this server" names its subject; a rule keying on `-er` would
     * read it as "update this, [make it] server-er" and fire.
     */
    expect(findVagueReferences('update this server')).toEqual([]);
  });

  it('always treats "it" as a pronoun', () => {
    expect(kinds('make it shorter')).toContain('demonstrative');
  });

  it('goes quiet once the draft has named something concrete', () => {
    // The antecedent is in the prompt, so the model is not being asked to
    // guess — it can see `auth.ts` right there.
    expect(findVagueReferences('open `auth.ts` and refactor this')).toEqual([]);
    expect(findVagueReferences('in src/session.ts, clean it up')).toEqual([]);
  });

  it('still fires when the concrete thing comes after the reference', () => {
    // Ordering matters: nothing had been named at the point of "this".
    expect(kinds('move this into src/session.ts')).toContain('demonstrative');
  });
});

describe('locatives', () => {
  it('fires on a place with no place named', () => {
    expect(kinds('put it over there')).toContain('locative');
  });

  it('ignores existential "there is"', () => {
    // "there is a bug" points at nothing; it is grammar, not a reference.
    expect(findVagueReferences('there is a bug')).toEqual([]);
    expect(findVagueReferences('there are three errors')).toEqual([]);
  });

  it('ignores a bare "there" with no locative preposition', () => {
    expect(findVagueReferences('go there')).toEqual([]);
  });
});

describe('prior-work phrases', () => {
  it.each([
    'do it like before',
    'same as before please',
    'use the above',
    'as we discussed',
    'you mentioned a workaround',
    'the previous version was better',
    'fix the same thing',
    'what you wrote last time',
  ])('fires on %j', (draft) => {
    expect(kinds(draft)).toContain('prior-work');
  });

  it('fires even when the draft names something concrete', () => {
    /*
     * The antecedent check does not apply to these. "like before" cannot be
     * resolved by anything in the draft, however specific the draft is — that
     * is precisely why it is worth asking about.
     */
    expect(kinds('update `auth.ts` like before')).toContain('prior-work');
  });
});

describe('reference spans', () => {
  it('reports offsets that index into the original draft', () => {
    const draft = 'add this over there';
    for (const ref of findVagueReferences(draft)) {
      expect(draft.slice(ref.start, ref.end)).toBe(ref.text);
    }
  });

  it('returns references in reading order', () => {
    const refs = findVagueReferences('add this over there like before');
    const starts = refs.map((r) => r.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('never overlaps two references', () => {
    const refs = findVagueReferences('do that one like before');
    expect(refs.length).toBeGreaterThan(1);

    refs.slice(1).forEach((ref, i) => {
      expect(ref.start).toBeGreaterThanOrEqual(refs[i]!.end);
    });
  });

  it('prefers the longer phrase when two patterns claim the same words', () => {
    // "that one" is a prior-work phrase and "that" is a demonstrative; the
    // user should be shown the phrase that actually carries the meaning.
    expect(texts('rewrite that one')).toEqual(['that one']);
  });
});

describe('anchor variety', () => {
  it('counts distinct kinds of concrete detail', () => {
    expect(anchorVariety('just make it better')).toBe(0);
    expect(anchorVariety('open auth.ts')).toBeGreaterThanOrEqual(1);
    expect(
      anchorVariety('open `auth.ts`, call validateToken() and log "expired"'),
    ).toBeGreaterThanOrEqual(2);
  });
});
