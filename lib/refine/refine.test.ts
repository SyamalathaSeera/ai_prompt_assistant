import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateRefinement, refine } from './index';
import {
  buildRefinementPrompt,
  cleanResponse,
  DEFAULT_STYLE,
  getStyle,
  RETIRED_STYLES,
  STYLES,
  type RefinementStyle,
} from './prompt';
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

describe('the offered styles', () => {
  /*
   * Three names for one setting is a menu someone reads; five is a list they
   * skim. Pinned here because `STYLES` drives three separate surfaces — the
   * composer picker, the options dropdown, and `STYLE_IDS` in the settings
   * migration — and a style added back in one place would silently appear in
   * all of them.
   */

  it('offers exactly the three that ship', () => {
    expect(STYLES.map((style) => style.id)).toEqual(['clear', 'detailed', 'technical']);
  });

  it('keeps the retired ones out of everything the user sees', () => {
    const offered = new Set(STYLES.map((style) => style.id));
    for (const retired of RETIRED_STYLES) expect(offered.has(retired.id)).toBe(false);
  });

  it('still resolves a retired style to its own instruction', () => {
    /*
     * `test/refine-corpus/` grades suggestions per style. If a retired id fell
     * through to the default, the corpus would quietly grade `clear` output
     * under a `concise` label — passing while meaning nothing.
     */
    for (const retired of RETIRED_STYLES) {
      expect(getStyle(retired.id).instruction).toBe(retired.instruction);
    }
  });

  it('falls back rather than throwing on an id it has never heard of', () => {
    expect(getStyle('nonsense' as RefinementStyle).id).toBe('clear');
  });

  it('gives every offered style a distinct instruction', () => {
    // Styles are distinct instructions, not tone adjectives. Two that read the
    // same produce the same rewrite, and the choice becomes theatre.
    const instructions = STYLES.map((style) => style.instruction);
    expect(new Set(instructions).size).toBe(STYLES.length);
  });

  it('defaults to one that is actually offered', () => {
    expect(STYLES.some((style) => style.id === DEFAULT_STYLE)).toBe(true);
  });
});

describe('saying why a rewrite was refused', () => {
  /*
   * Every one of the six checks used to produce the same sentence: "the
   * rewrite drifted from what you wrote". True in all six cases and useful in
   * none — someone who sees it twice cannot tell whether to reword the draft,
   * pick a different style, or give up. It also hid the one fact worth having
   * during a beta, which is which check keeps firing.
   */

  const DRAFT = 'deploy the billing service and connect it to the orders database';

  it('names what the model made up', async () => {
    /*
     * The most common failure on a real draft, and the most checkable claim
     * we can make about it. "It added EC2" can be verified by the user in a
     * second; "it drifted" cannot be verified at all.
     */
    installModel(
      () =>
        'Deploy the billing service to an EC2 instance in us-east-1 and connect it ' +
        'to the orders database.',
    );

    const result = await refine(DRAFT, { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.problems).toContain('fabricated-specifics');
    expect(result.message).toContain('added details you never wrote');
    expect(result.message).toMatch(/us-east-1|ec2/i);
  });

  it('says so when the model answered instead of rewriting', async () => {
    // A different thing to do about it: the draft is fine, the model is not.
    installModel(
      () =>
        'To deploy the billing service you should first provision the environment, ' +
        'then configure the connection string, then run the migration, then verify ' +
        'the health check responds, then switch traffic across, then watch the logs ' +
        'for errors, then confirm the orders database is reachable, then update the ' +
        'runbook, then tell the team, then close the ticket and take the afternoon.',
    );

    const result = await refine(DRAFT, { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('answered the prompt');
  });

  it('says so when the rewrite lost the subject', async () => {
    installModel(() => 'Please help me with something on the computer today.');

    const result = await refine(DRAFT, { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toContain('intent-lost');
    expect(result.message).toContain('lost most of what you were asking');
  });

  it('reports the most actionable problem when several fired at once', async () => {
    /*
     * Rewrites usually break more than one rule, and only the first line gets
     * read. A fabrication is the one the user can check and act on, so it
     * outranks the rest.
     */
    installModel(() => 'Deploy to EC2 in us-east-1.');

    const result = await refine(DRAFT, { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems!.length).toBeGreaterThan(1);
    expect(result.message).toContain('added details you never wrote');
  });

  it('carries the failed checks, not just a sentence about them', async () => {
    // The evaluator computes this either way. Dropping it left the only
    // useful fact about the failure on the floor.
    installModel(() => 'Deploy the billing service to an EC2 instance in us-east-1.');

    const result = await refine(DRAFT, { rules: ALL_RULES });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Array.isArray(result.problems)).toBe(true);
  });

  it('never names a value the user redacted', async () => {
    /*
     * Fabrications are words the model produced, and the model only ever saw
     * redacted text — so one cannot be a user secret. Asserted rather than
     * reasoned about, because this message goes on screen.
     */
    installModel(() => 'Deploy using an EC2 instance in us-east-1 with the key.');

    const result = await refine(`deploy with key ${AWS_KEY} to the orders database`, {
      rules: ALL_RULES,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain(AWS_KEY);
  });
});

describe('what the model is asked to read', () => {
  /*
   * Measured on the real model, time scales with output length: roughly three
   * seconds before the first word, then about 230ms per word after it. The
   * per-word rate is the device and is not ours to change. The fixed part is
   * partly the instruction we send, and that is.
   */

  it('leaves out the placeholder rule when there is nothing to protect', async () => {
    /*
     * The longest line in the instruction, and on a draft with no secrets it
     * is a rule about nothing. Every character is prefill the user waits for.
     */
    const { seen } = installModel(() => 'Fix the bug in the login flow.');

    await refine('fix the login bug', { rules: ALL_RULES });

    expect(seen[0]).not.toContain('[REDACTED_SOMETHING_1]');
  });

  it('sends the placeholder rule when the draft actually has one', async () => {
    // The saving must never come at the cost of the rule that stops the model
    // mangling a placeholder and breaking re-hydration.
    const { seen } = installModel(
      () => 'Deploy the service using key [REDACTED_AWS_ACCESS_KEY_ID_1].',
    );

    await refine(`deploy the service with key ${AWS_KEY}`, { rules: ALL_RULES });

    expect(seen[0]).toContain('[REDACTED_SOMETHING_1]');
  });

  it('is meaningfully shorter without it', () => {
    const withRule = buildRefinementPrompt('fix the login bug', 'clear', {
      hasPlaceholders: true,
    });
    const without = buildRefinementPrompt('fix the login bug', 'clear', {
      hasPlaceholders: false,
    });

    // Around a fifth of the whole instruction, on the majority of drafts.
    expect(without.length).toBeLessThan(withRule.length * 0.82);
  });

  it('keeps every rule that is not about placeholders', () => {
    // The saving is one conditionally irrelevant rule, not a trim of the
    // instruction. The rest are what the quality gate exists to enforce.
    const without = buildRefinementPrompt('fix the login bug', 'clear', {
      hasPlaceholders: false,
    });

    expect(without).toContain('Preserve the original meaning');
    expect(without).toContain('Do not answer the prompt');
    expect(without).toContain('Do not add facts');
    expect(without).toContain('Do not add a preamble');
  });

  it('still defaults to sending it when nobody said either way', () => {
    // A caller that forgets should get the safe behaviour, not the fast one.
    expect(buildRefinementPrompt('draft', 'clear')).toContain(
      '[REDACTED_SOMETHING_1]',
    );
  });
});

describe('style instructions say what to do', () => {
  /*
   * The division of labour that keeps these working on a small model: the
   * global rules carry every prohibition, and a style instruction carries only
   * the thing to do. "More specific" was reported as barely editing anything,
   * and the cause was that it carried both — "spell out what a complete answer
   * should include" followed by "do not invent requirements the original does
   * not imply", which is a rule already sent with every prompt. Two brakes on
   * one accelerator, and the model settled it by doing nothing.
   */

  it.each([...STYLES, ...RETIRED_STYLES])(
    'the $label instruction is not a prohibition',
    (style) => {
      expect(style.instruction).not.toMatch(/\bdo not\b/i);
      expect(style.instruction).not.toMatch(/\bnever\b/i);
      expect(style.instruction).not.toMatch(/\bavoid inventing\b/i);
    },
  );

  it('does not repeat a rule the global instruction already carries', () => {
    /*
     * "Do not add requirements that are not in the original" is a global rule
     * sent with every prompt. The old More specific instruction said it a
     * second time, which cost prefill the user waits through and told a small
     * model to hold back twice as hard.
     *
     * Counted on the word rather than the phrasing, because a paraphrase of
     * the same rule is the same mistake.
     */
    for (const style of STYLES) {
      const prompt = buildRefinementPrompt('why is it slow', style.id);
      expect(prompt.match(/requirements/gi) ?? []).toHaveLength(1);
    }
  });

  it('asks More specific to expand rather than to hold back', () => {
    const detailed = STYLES.find((style) => style.id === 'detailed')!;

    expect(detailed.instruction).toMatch(/spell out|cover|form it should take/i);
    // The restraint that remains is phrased as an action: ask for what is
    // missing, rather than a ban on supplying it.
    expect(detailed.instruction).toMatch(/ask for it/i);
  });

  it('leaves the gate room for a genuinely expanded rewrite', () => {
    /*
     * Worth pinning separately, because a fix to the instruction is worthless
     * if the evaluator then refuses the result. A vague draft expanded into a
     * properly specified one runs to several times the original length, and
     * every word of it traces back to the draft.
     */
    const report = evaluateRefinement(
      'why is it slow',
      'Why is it slow? Cover the most likely causes, how to tell them apart, and ' +
        'what to measure first.',
      'detailed',
    );

    expect(report.ok).toBe(true);
    expect(report.lengthRatio).toBeGreaterThan(3);
    expect(report.invented).toEqual([]);
  });
});
