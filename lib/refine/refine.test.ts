import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refine } from './index';
import { buildRefinementPrompt, cleanResponse, STYLES } from './prompt';
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

beforeEach(() => {
  vi.unstubAllGlobals();
  __resetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetForTests();
});

describe('the model never sees a secret', () => {
  it('sends redacted text only', async () => {
    // The single most important property in this milestone. Even on-device,
    // this ordering is what stands between a secret and any future remote
    // model.
    const draft = `Fix my auth. Key is ${AWS_KEY}`;
    const { seen } = installModel(() => 'Please help me fix my authentication setup.');

    await refine(draft, { rules: ALL_RULES });

    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain(AWS_KEY);
    expect(seen[0]).toContain('[REDACTED_');
  });

  it('sends redacted text even when the draft is edited between scans', async () => {
    const draft = `key ${AWS_KEY} and sk_live_9mQ4vX2nR7tK1pL5wZ8yB3cF`;
    const { seen } = installModel(() => 'A clearer request about my keys.');

    await refine(draft, { rules: ALL_RULES });

    expect(seen[0]).not.toContain(AWS_KEY);
    expect(seen[0]).not.toContain('sk_live_9mQ4vX2nR7tK1pL5wZ8yB3cF');
  });

  it('restores the user’s values in the suggestion shown back', async () => {
    const draft = `Fix my auth. Key is ${AWS_KEY}`;
    installModel((prompt) => {
      // Echo the redacted draft with a small edit, preserving placeholders.
      const match = /---\n([\s\S]*?)\n---/.exec(prompt);
      return `Please help: ${match?.[1] ?? ''}`;
    });

    const result = await refine(draft, { rules: ALL_RULES });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Restoration is a local substitution; the value never left the machine.
      expect(result.text).toContain(AWS_KEY);
      expect(result.text).not.toContain('[REDACTED_');
    }
  });
});

describe('rejecting bad suggestions', () => {
  it('discards a response that mangled a placeholder', async () => {
    installModel(() => 'Fix my auth. Key is [REDACTED_KEY]');

    const result = await refine(`Fix my auth. Key is ${AWS_KEY}`, { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsafe');
      expect(result.message).toContain('discarded');
    }
  });

  it('discards a response that introduced a secret', async () => {
    installModel(() => 'Try using AKIAIOSFODNN7EXAMPLE as your key');

    const result = await refine('How do I configure AWS?', { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsafe');
  });

  it('says so rather than offering an identical rewrite', async () => {
    // A diff with nothing in it wastes the user's attention and makes the
    // feature feel broken.
    installModel(() => 'How do promises work?');

    const result = await refine('How do promises work?', { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no-change');
      expect(result.message).toContain('already reads clearly');
    }
  });

  it('ignores whitespace-only differences', async () => {
    installModel(() => '  How   do promises work?  ');

    const result = await refine('How do promises work?', { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-change');
  });
});

describe('failure leaves the draft untouched', () => {
  it('reports unavailable with no model', async () => {
    const result = await refine('improve this', { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unavailable');
      expect(result.message).toContain('not available');
    }
  });

  it('never throws, whatever the model does', async () => {
    installModel(() => {
      throw new Error('model exploded');
    });

    await expect(refine('x', { rules: ALL_RULES })).resolves.toMatchObject({ ok: false });
  });

  it('refuses an empty draft with a useful message', async () => {
    installModel(() => 'anything');

    const result = await refine('   ', { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('nothing to improve');
  });

  it('every failure carries a message written for a person', async () => {
    // These strings go straight into the UI. "unavailable" is not a sentence.
    const result = await refine('x', { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(15);
      expect(result.message).toMatch(/[.!]$/);
      expect(result.message).not.toMatch(/undefined|null|Error/);
    }
  });
});

describe('the instruction', () => {
  it('tells the model to preserve intent above all', () => {
    const prompt = buildRefinementPrompt('do the thing', 'clear');
    expect(prompt).toContain('Preserve the original meaning and intent exactly');
  });

  it('forbids inventing specifics', () => {
    // If the draft says "the login bug", the refinement must not name a file
    // the user never mentioned. A confident fabrication is harder to spot than
    // a vague original.
    const prompt = buildRefinementPrompt('fix the login bug', 'detailed');
    expect(prompt).toContain('Do not add facts, names, file paths');
  });

  it('forbids answering the prompt instead of rewriting it', () => {
    const prompt = buildRefinementPrompt('what is a closure?', 'clear');
    expect(prompt).toContain('Do not answer the prompt');
  });

  it('tells the model to copy placeholders through exactly', () => {
    const prompt = buildRefinementPrompt('key [REDACTED_AWS_1]', 'clear');
    expect(prompt).toContain('Copy each one through exactly');
  });

  it('gives every style a distinct instruction', () => {
    // Styles are instructions, not tone adjectives. If two produced the same
    // guidance there would be no reason to offer both.
    const instructions = STYLES.map((s) => s.instruction);
    expect(new Set(instructions).size).toBe(STYLES.length);
  });

  it('describes each style by outcome, for the picker', () => {
    for (const style of STYLES) {
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.description.length).toBeGreaterThan(10);
    }
  });
});

describe('cleaning the response', () => {
  it.each([
    ["Here's an improved version: Do the thing", 'Do the thing'],
    ['Improved prompt: Do the thing', 'Do the thing'],
    ['```\nDo the thing\n```', 'Do the thing'],
    ['```text\nDo the thing\n```', 'Do the thing'],
    ['"Do the thing"', 'Do the thing'],
    ['  Do the thing  ', 'Do the thing'],
  ])('strips %s', (raw, expected) => {
    // These wrappers would otherwise be sent to the chat as if the user had
    // typed them.
    expect(cleanResponse(raw)).toBe(expected);
  });

  it('leaves legitimate internal quotes alone', () => {
    const text = 'Explain what "hoisting" means in JavaScript';
    expect(cleanResponse(text)).toBe(text);
  });

  it('leaves ordinary text untouched', () => {
    expect(cleanResponse('Rewrite the login handler to use async/await')).toBe(
      'Rewrite the login handler to use async/await',
    );
  });
});
