import { describe, expect, it } from 'vitest';
import {
  assembleContext,
  estimateTokens,
  isContextFor,
  MAX_CONTEXT_TURNS,
} from './context';
import type { ContextTurn } from './context';
import type { ChatMessage } from '../adapters/types';
import { ALL_RULES } from '../detector/rules';

const CHAT = 'conv-1';
const opts = { conversationId: CHAT, rules: ALL_RULES };

const turn = (
  role: ContextTurn['role'],
  text: string,
  id: string | null = null,
): ContextTurn => ({ role, text, id });

const ok = (result: ReturnType<typeof assembleContext>) => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected context, got ${result.reason}`);
  return result.context;
};

describe('redacting the conversation', () => {
  const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';

  it('contains no detected secret', () => {
    /*
     * The whole reason this file redacts at all. These turns were sent before
     * the extension existed, or approved deliberately at the time — either
     * way, reading them into a model prompt must not re-expose them.
     */
    const context = ok(
      assembleContext(
        [
          turn('user', `deploy with key ${AWS_KEY} please`),
          turn('assistant', 'Done. Anything else?'),
        ],
        opts,
      ),
    );

    expect(context.text).not.toContain(AWS_KEY);
    expect(context.text).toContain('[REDACTED_');
    expect(context.findings.length).toBeGreaterThan(0);
  });

  it('redacts a secret the assistant echoed back', () => {
    // The assistant repeating a key is just as much of a leak as the user
    // sending one, and it is the easier case to forget.
    const context = ok(
      assembleContext(
        [
          turn('user', 'what did I just give you?'),
          turn('assistant', `You provided ${AWS_KEY}.`),
        ],
        opts,
      ),
    );

    expect(context.text).not.toContain(AWS_KEY);
  });

  it('keeps a map that can restore the real values locally', () => {
    const context = ok(
      assembleContext([turn('user', `key is ${AWS_KEY}`)], opts),
    );

    expect(Object.values(context.map)).toContain(AWS_KEY);
  });

  it('numbers placeholders once across the whole context', () => {
    /*
     * Redacting turn by turn would mint `[REDACTED_..._1]` in each one, for
     * two different keys, and the model would reasonably read them as the
     * same value. One pass over the joined text is what prevents that.
     */
    const other = 'AKIA4QF9WXSYNTHETIC2';
    const context = ok(
      assembleContext(
        [turn('user', `first ${AWS_KEY}`), turn('user', `second ${other}`)],
        opts,
      ),
    );

    const placeholders = context.text.match(/\[REDACTED_[^\]]+\]/g) ?? [];
    expect(placeholders).toHaveLength(2);
    expect(new Set(placeholders).size).toBe(2);
  });

  it('leaves ordinary conversation readable', () => {
    // Redaction has to preserve enough for the context to still be context.
    const context = ok(
      assembleContext(
        [turn('user', 'refactor the session module'), turn('assistant', 'Which part?')],
        opts,
      ),
    );

    expect(context.text).toContain('refactor the session module');
    expect(context.text).toContain('Which part?');
  });
});

describe('truncating on turn boundaries', () => {
  it('never cuts inside a message', () => {
    /*
     * Half a turn is worse than one fewer turn: it still reads as a complete
     * statement, so a model resolves against it confidently and wrongly.
     */
    const turns = [
      turn('user', 'A'.repeat(400)),
      turn('assistant', 'B'.repeat(400)),
      turn('user', 'C'.repeat(400)),
    ];

    const context = ok(assembleContext(turns, { ...opts, budgetTokens: 150 }));

    for (const included of context.turns) {
      const original = turns[included.index]!.text.trim();
      expect(context.text).toContain(original);
    }
  });

  it('drops whole turns rather than trimming them', () => {
    const turns = [
      turn('user', 'A'.repeat(400)),
      turn('assistant', 'B'.repeat(400)),
      turn('user', 'C'.repeat(400)),
    ];

    const context = ok(assembleContext(turns, { ...opts, budgetTokens: 150 }));

    expect(context.turns.length).toBeLessThan(turns.length);
    expect(context.omittedTurns).toBe(turns.length - context.turns.length);
  });

  it('prefers the most recent turns', () => {
    // Recency is what makes context useful for resolving a reference.
    const turns = [
      turn('user', 'oldest'),
      turn('assistant', 'middle'),
      turn('user', 'newest'),
    ];

    const context = ok(assembleContext(turns, { ...opts, budgetTokens: 6 }));

    expect(context.text).toContain('newest');
    expect(context.text).not.toContain('oldest');
  });

  it('presents the turns it kept in the order they happened', () => {
    const turns = [
      turn('user', 'first thing'),
      turn('assistant', 'second thing'),
      turn('user', 'third thing'),
    ];

    const context = ok(assembleContext(turns, opts));

    expect(context.turns.map((t) => t.index)).toEqual([0, 1, 2]);
    expect(context.text.indexOf('first thing')).toBeLessThan(
      context.text.indexOf('third thing'),
    );
  });

  it('declines when even the newest turn will not fit', () => {
    const result = assembleContext([turn('user', 'A'.repeat(4000))], {
      ...opts,
      budgetTokens: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('turns-too-large');
  });

  it('caps the number of turns regardless of budget', () => {
    const turns = Array.from({ length: 40 }, (_, i) => turn('user', `turn ${i}`));

    const context = ok(assembleContext(turns, { ...opts, budgetTokens: 100_000 }));

    expect(context.turns.length).toBe(MAX_CONTEXT_TURNS);
    expect(context.omittedTurns).toBe(40 - MAX_CONTEXT_TURNS);
  });
});

describe('conversation scoping', () => {
  it('reads only the turns it was given', () => {
    // The adapter decides what a conversation is; this module cannot reach
    // past its own argument to find another one.
    const context = ok(assembleContext([turn('user', 'only this chat')], opts));

    expect(context.text).toContain('only this chat');
    expect(context.turns).toHaveLength(1);
  });

  it('stamps the conversation it came from', () => {
    expect(ok(assembleContext([turn('user', 'hello')], opts)).conversationId).toBe(CHAT);
  });

  it('refuses to be used by a different conversation', () => {
    /*
     * An SPA route change swaps the conversation without unloading the content
     * script, so context held across one would otherwise show a previous
     * chat's content inside the current one.
     */
    const context = ok(assembleContext([turn('user', 'hello')], opts));

    expect(isContextFor(context, CHAT)).toBe(true);
    expect(isContextFor(context, 'conv-2')).toBe(false);
    expect(isContextFor(context, null)).toBe(false);
  });

  it('declines a chat with no conversation id yet', () => {
    const result = assembleContext([turn('user', 'hello')], {
      ...opts,
      conversationId: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-conversation');
  });
});

describe('empty and degenerate input', () => {
  it('declines an empty conversation', () => {
    const result = assembleContext([], opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-turns');
  });

  it('ignores blank turns without letting them shift the indices', () => {
    const turns = [turn('user', '   '), turn('assistant', 'real content')];

    const context = ok(assembleContext(turns, opts));

    expect(context.turns).toHaveLength(1);
    // Index 1, not 0: the handle has to point at the right message on the page.
    expect(context.turns[0]!.index).toBe(1);
  });

  it('labels who said what', () => {
    const context = ok(
      assembleContext([turn('user', 'ask'), turn('assistant', 'answer')], opts),
    );

    expect(context.text).toContain('User: ask');
    expect(context.text).toContain('Assistant: answer');
  });

  it('carries the host page message id when there is one', () => {
    const context = ok(assembleContext([turn('user', 'hello', 'msg-7')], opts));
    expect(context.turns[0]!.id).toBe('msg-7');
  });
});

describe('the adapter boundary', () => {
  it("takes an adapter's messages without conversion", () => {
    /*
     * A compile-time assertion: `ContextTurn` is a structural subset of the
     * adapter's `ChatMessage`, so `getMessages()` output feeds straight in.
     *
     * That is what lets this module stay in the DOM-free test project while
     * consuming something whose real shape carries an `HTMLElement`. If anyone
     * adds a required field to `ContextTurn`, this stops compiling — which is
     * the point, because the alternative is a mapping layer that quietly drops
     * the index the provenance UI depends on.
     */
    const accepts = (messages: readonly ChatMessage[]): readonly ContextTurn[] =>
      messages;

    expect(typeof accepts).toBe('function');
  });
});

describe('token estimation', () => {
  it('grows with length and never returns zero for real text', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBeGreaterThan(0);
    expect(estimateTokens('a'.repeat(400))).toBeGreaterThan(estimateTokens('a'.repeat(40)));
  });
});
