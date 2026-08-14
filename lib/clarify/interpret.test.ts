import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interpret } from './interpret';
import { assembleContext } from './context';
import type { ContextTurn } from './context';
import { findVagueReferences } from './references';
import { __resetForTests } from '../model/session';
import { ALL_RULES } from '../detector/rules';

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';

/** Installs a fake model that records what it was asked. */
function installModel(reply: (prompt: string) => string) {
  const seen: string[] = [];

  vi.stubGlobal('LanguageModel', {
    availability: async () => 'available',
    create: async () => ({
      prompt: async (input: string) => {
        seen.push(input);
        return reply(input);
      },
      destroy: () => {},
    }),
  });

  return { seen };
}

const turn = (
  role: ContextTurn['role'],
  text: string,
  id: string | null = null,
): ContextTurn => ({ role, text, id });

const TURNS: ContextTurn[] = [
  turn('user', 'I am working on the login form', 'm1'),
  turn('assistant', 'The settings page uses a different layout', 'm2'),
];

const contextFor = (turns: readonly ContextTurn[], options = {}) => {
  const result = assembleContext(turns, {
    conversationId: 'c1',
    rules: ALL_RULES,
    ...options,
  });
  if (!result.ok) throw new Error(`could not assemble: ${result.reason}`);
  return result.context;
};

const run = (
  draft: string,
  turns: readonly ContextTurn[] = TURNS,
  context = contextFor(turns),
) => interpret(draft, context, findVagueReferences(draft), turns, { rules: ALL_RULES });

beforeEach(() => {
  vi.unstubAllGlobals();
  __resetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetForTests();
});

describe('the model never sees a secret', () => {
  it('redacts the draft before asking', async () => {
    const { seen } = installModel(() => 'add the login form to the settings page');

    await run(`add this over there, key is ${AWS_KEY}`);

    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain(AWS_KEY);
    expect(seen[0]).toContain('[REDACTED_');
  });

  it('redacts the conversation before asking', async () => {
    /*
     * The exposure unique to this feature. The draft was already handled by
     * the refinement guard; the conversation is new, and it can hold secrets
     * sent before this extension existed.
     */
    const turns = [
      turn('user', `deploy with ${AWS_KEY} to the login form`),
      turn('assistant', 'Done.'),
    ];
    const { seen } = installModel(() => 'add the login form');

    await run('add this', turns);

    expect(seen[0]).not.toContain(AWS_KEY);
  });
});

describe('what it asks the model', () => {
  it('includes the conversation and the references in question', async () => {
    const { seen } = installModel(() => 'add the login form to the settings page');

    await run('add this over there');

    expect(seen[0]).toContain('login form');
    expect(seen[0]).toContain('"this"');
    // The whole phrase, not the bare adverb: "over there" is the reference.
    expect(seen[0]).toContain('"over there"');
  });

  it('tells the model to leave an unclear reference alone', async () => {
    // Restraint stated in the instruction, not only enforced afterwards.
    const { seen } = installModel(() => 'add the login form');

    await run('add this');

    expect(seen[0]?.toLowerCase()).toContain('leave that reference exactly');
  });
});

describe('producing an interpretation', () => {
  it('returns the resolved text with the turn each phrase came from', async () => {
    installModel(() => 'add the login form to the settings page');

    const result = await run('add this over there');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.text).toBe('add the login form to the settings page');
    expect(result.resolutions.length).toBeGreaterThan(0);

    for (const resolution of result.resolutions) {
      expect(TURNS[resolution.turnIndex]).toBeDefined();
    }
  });

  it('puts the user real values back into the suggestion', async () => {
    installModel((prompt) => {
      // Anchored on the rule family, not on `REDACTED_` alone: the instruction
      // itself contains `[REDACTED_SOMETHING_1]` as an example, and matching
      // that would echo back a placeholder the draft never had.
      const placeholder = /\[REDACTED_AWS[^\]]*\]/.exec(prompt)?.[0] ?? '';
      return `add the login form using ${placeholder}`;
    });

    const result = await run(`add this using ${AWS_KEY}`);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain(AWS_KEY);
  });
});

describe('refusing an interpretation', () => {
  it('refuses one that invents something the conversation does not contain', async () => {
    installModel(() => 'add the payment webhook to the billing dashboard');

    const result = await run('add this over there');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('ungrounded');
  });

  it('refuses one that rewrote the prompt instead of resolving it', async () => {
    // Asked to resolve a reference, the model answered a different question.
    installModel(() => 'Could you walk me through your deployment process?');

    const result = await run('add this over there');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('rewrote-too-much');
  });

  it('refuses one that damaged a placeholder', async () => {
    installModel(() => 'add the login form using [REDACTED_SOMETHING_ELSE_9]');

    const result = await run(`add this using ${AWS_KEY}`);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsafe');
  });

  it('reports no change when the model left the draft alone', async () => {
    // The instructed behaviour when a reference cannot be resolved.
    installModel(() => 'add this over there');

    const result = await run('add this over there');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-change');
  });

  it('reports no change when nothing traceable was added', async () => {
    installModel(() => 'over there, add this');

    const result = await run('add this over there');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-change');
  });

  it('returns a failure rather than throwing when there is no model', async () => {
    vi.stubGlobal('LanguageModel', undefined);

    const result = await run('add this over there');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unavailable');
      expect(result.message).not.toBe('');
    }
  });

  it('strips a preamble the model added anyway', async () => {
    installModel(() => "Here's the clarified version:\nadd the login form to the settings page");

    const result = await run('add this over there');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).not.toContain("Here's");
  });
});

describe('the draft is never touched', () => {
  it('changes nothing about the caller draft on any outcome', async () => {
    const draft = 'add this over there';

    for (const reply of [
      'add the payment webhook somewhere new',
      'add this over there',
      '',
      'Could you walk me through your deployment process?',
    ]) {
      installModel(() => reply);
      await run(draft);
      expect(draft).toBe('add this over there');
    }
  });
});
