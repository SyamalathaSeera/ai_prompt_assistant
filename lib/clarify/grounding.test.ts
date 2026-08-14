import { describe, expect, it } from 'vitest';
import { addedPhrases, groundResolutions, stem } from './grounding';
import { assembleContext } from './context';
import type { ContextTurn } from './context';

const turn = (
  role: ContextTurn['role'],
  text: string,
  id: string | null = null,
): ContextTurn => ({ role, text, id });

/** Builds the included-turn list the way the real pipeline would. */
const include = (turns: readonly ContextTurn[]) => {
  const result = assembleContext(turns, { conversationId: 'c1' });
  if (!result.ok) throw new Error(`could not assemble: ${result.reason}`);
  return result.context.turns;
};

describe('finding what the rewrite added', () => {
  it('reports a phrase the draft did not contain', () => {
    expect(addedPhrases('add this', 'add the login form')).toContain('login form');
  });

  it('reports nothing when the rewrite added nothing', () => {
    expect(addedPhrases('fix the login form', 'fix the login form')).toEqual([]);
  });

  it('bridges a grammatical word so a phrase stays whole', () => {
    // "the login form on the settings page" must come back as usable phrases,
    // not as three fragments each needing separate attribution.
    const phrases = addedPhrases('add this over there', 'add the login form to the settings page');
    expect(phrases.some((p) => p.includes('login form'))).toBe(true);
    expect(phrases.some((p) => p.includes('settings page'))).toBe(true);
  });

  it('does not report re-inflection as new content', () => {
    // "query" becoming "queries" is grammar, not an invention.
    expect(addedPhrases('fix the query', 'fix the queries')).toEqual([]);
    expect(addedPhrases('add logging', 'add the log')).toEqual([]);
  });

  it('ignores placeholders', () => {
    // They are the guard's business, and they are full of the shapes these
    // patterns look for.
    expect(addedPhrases('send [REDACTED_AWS_KEY_1]', 'send [REDACTED_AWS_KEY_1]')).toEqual([]);
  });

  it('makes inflected forms of a word agree', () => {
    // The property that matters is agreement, not any particular stem.
    expect(stem('queries')).toBe(stem('query'));
    expect(stem('running')).toBe(stem('run'));
    expect(stem('logs')).toBe(stem('log'));
    expect(stem('pages')).toBe(stem('page'));
    expect(stem('tests')).toBe(stem('test'));
  });

  it('does not collapse unrelated words', () => {
    expect(stem('address')).not.toBe(stem('addres'));
    expect(stem('login')).not.toBe(stem('log'));
  });
});

describe('attributing a resolution to its turn', () => {
  const turns = [
    turn('user', 'I am working on the login form', 'm1'),
    turn('assistant', 'The settings page has a different layout', 'm2'),
  ];

  it('names the turn each phrase came from', () => {
    const result = groundResolutions(
      'add this over there',
      'add the login form to the settings page',
      turns,
      include(turns),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byText = Object.fromEntries(
      result.resolutions.map((r) => [r.text.toLowerCase(), r]),
    );

    expect(byText['login form']?.turnIndex).toBe(0);
    expect(byText['login form']?.turnId).toBe('m1');
    expect(byText['login form']?.role).toBe('user');

    expect(byText['settings page']?.turnIndex).toBe(1);
    expect(byText['settings page']?.role).toBe('assistant');
  });

  it('gives every resolution a turn, or refuses', () => {
    /*
     * The guarantee Task 3 rests on. A resolution that cannot name its source
     * is not displayed with a caveat — the whole interpretation is refused,
     * because the user is being asked a yes/no question and a question
     * containing a fabrication is a trap.
     */
    const result = groundResolutions(
      'add this over there',
      'add the login form to the settings page',
      turns,
      include(turns),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const resolution of result.resolutions) {
        expect(resolution.turnIndex).toBeGreaterThanOrEqual(0);
        expect(turns[resolution.turnIndex]).toBeDefined();
      }
    }
  });

  it('refuses a phrase that appears nowhere in the conversation', () => {
    const result = groundResolutions(
      'add this over there',
      'add the payment webhook to the settings page',
      turns,
      include(turns),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ungrounded.join(' ').toLowerCase()).toContain('payment');
    }
  });

  it('refuses an invented file path', () => {
    // The shape a model reaches for when filling in a blank, and the one the
    // phrase walk is least likely to reassemble on its own.
    const result = groundResolutions(
      'fix this',
      'fix src/payments/webhook.ts',
      turns,
      include(turns),
    );

    expect(result.ok).toBe(false);
  });

  it('refuses a phrase found only in a turn the model was never shown', () => {
    /*
     * The distinction between "in the conversation" and "in the context we
     * assembled". A phrase from a turn dropped by the budget cannot have been
     * read by the model, so its appearance is a coincidence — treating it as
     * grounded would launder a fabrication.
     */
    const long = [
      turn('user', 'the deployment pipeline is broken'),
      turn('assistant', 'X'.repeat(600)),
      turn('user', 'Y'.repeat(600)),
    ];
    const included = (() => {
      const result = assembleContext(long, {
        conversationId: 'c1',
        budgetTokens: 200,
      });
      if (!result.ok) throw new Error(result.reason);
      return result.context.turns;
    })();

    // The first turn did not survive the budget.
    expect(included.some((t) => t.index === 0)).toBe(false);

    const result = groundResolutions(
      'fix this',
      'fix the deployment pipeline',
      long,
      included,
    );

    expect(result.ok).toBe(false);
  });

  it('accepts a resolution that differs by inflection from its turn', () => {
    const source = [turn('user', 'the failing test keeps timing out')];
    const result = groundResolutions(
      'fix this',
      'fix the failing tests',
      source,
      include(source),
    );

    expect(result.ok).toBe(true);
  });

  it('reports no resolutions when the rewrite only reordered words', () => {
    const source = [turn('user', 'anything')];
    const result = groundResolutions('fix the bug', 'the bug, fix', source, include(source));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolutions).toEqual([]);
  });
});
