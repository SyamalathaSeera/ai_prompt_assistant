import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refine, REFINE_TIMEOUT_MS, type RefineResult } from './index';
import { evaluateRefinement } from './evaluate';
import { __resetForTests } from '../model/session';
import { ALL_RULES } from '../detector/rules';
import {
  GRADED_SUGGESTIONS,
  REFINE_FIXTURES,
  type RefineFixture,
} from '../../test/refine-corpus/fixtures';

/**
 * The quality gate.
 *
 * The detector has a labelled corpus and a numeric gate; this is refinement's
 * equivalent. It measures the **gate**, not the model: each graded suggestion
 * is what an on-device model plausibly returns, and the assertion is that the
 * pipeline accepts the good ones and refuses the bad ones.
 *
 * That distinction is the honest one. Real model output quality is a beta
 * question — the same caveat the detector corpus carries. What can be pinned
 * in CI is that a suggestion which loses the user's meaning, invents a
 * filename, or answers the prompt instead of rewriting it never reaches them.
 */

const fixture = (id: string): RefineFixture => {
  const found = REFINE_FIXTURES.find((f) => f.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

/**
 * Substitutes the placeholder tokens a graded suggestion refers to.
 *
 * Read from the prompt the model was actually given, so the corpus does not
 * hard-code a token that a rule's label could change out from under it.
 */
function fillPlaceholders(suggestion: string, modelPrompt: string): string {
  // From the draft only. The instruction itself names an example placeholder,
  // and taking that one would substitute a token the draft never contained.
  const token = /\[[A-Z][A-Z0-9_]*\]/.exec(bodyOf(modelPrompt))?.[0] ?? '[REDACTED_1]';
  return suggestion
    .replace(/\{\{PLACEHOLDER\}\}/g, token)
    .replace(/\{\{MANGLED\}\}/g, token.replace(/_\d+\]$/, ']'));
}

/** The draft as the model sees it: redacted, between the delimiters. */
function bodyOf(modelPrompt: string): string {
  return /---\n([\s\S]*?)\n---/.exec(modelPrompt)?.[1] ?? '';
}

/** Stands in for the on-device model, returning a scripted response. */
function scriptModel(reply: (prompt: string) => string, delayMs = 0): void {
  vi.stubGlobal('LanguageModel', {
    availability: async () => 'available',
    create: async () => ({
      prompt: (input: string, options?: { signal?: AbortSignal }) =>
        new Promise<string>((resolve, reject) => {
          if (delayMs === 0) {
            resolve(reply(input));
            return;
          }
          const timer = setTimeout(() => resolve(reply(input)), delayMs);
          options?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
      destroy: () => {},
    }),
  });
}

const refineWith = (draft: string, style: RefineFixture['styles'][number]) =>
  refine(draft, { style, rules: ALL_RULES });

beforeEach(() => {
  vi.unstubAllGlobals();
  __resetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetForTests();
});

describe('the graded corpus', () => {
  const accepted = GRADED_SUGGESTIONS.filter((s) => s.acceptable);
  const refused = GRADED_SUGGESTIONS.filter((s) => !s.acceptable);

  it('has enough of both kinds to mean anything', () => {
    // A gate measured only against good output would pass while catching
    // nothing in the wild.
    expect(accepted.length).toBeGreaterThanOrEqual(8);
    expect(refused.length).toBeGreaterThanOrEqual(8);
  });

  it.each(accepted)('accepts: $fixtureId — $note', async (graded) => {
    scriptModel((prompt) => fillPlaceholders(graded.suggestion, prompt));

    const result = await refineWith(fixture(graded.fixtureId).draft, graded.style);

    expect(
      result.ok ? 'accepted' : `refused (${result.reason})`,
      `${graded.fixtureId} [${graded.style}]: ${graded.note}`,
    ).toBe('accepted');
  });

  it.each(refused)('refuses: $fixtureId — $note', async (graded) => {
    scriptModel((prompt) => fillPlaceholders(graded.suggestion, prompt));

    const result = await refineWith(fixture(graded.fixtureId).draft, graded.style);

    expect(result.ok, `${graded.fixtureId} [${graded.style}]: ${graded.note}`).toBe(false);
    if (!result.ok) {
      // Every refusal has to say something a person can act on, or the feature
      // just appears broken.
      expect(result.message.length).toBeGreaterThan(10);
      expect(result.message).toMatch(/[a-z]\.$/i);
    }
  });

  it('refuses nothing acceptable and accepts nothing it should refuse', async () => {
    // Stated as a rate, because that is the number worth watching as the corpus
    // grows: a gate is only useful if both error kinds stay at zero.
    let falseRefusals = 0;
    let falseAccepts = 0;

    for (const graded of GRADED_SUGGESTIONS) {
      __resetForTests();
      scriptModel((prompt) => fillPlaceholders(graded.suggestion, prompt));
      const result = await refineWith(fixture(graded.fixtureId).draft, graded.style);

      if (graded.acceptable && !result.ok) falseRefusals += 1;
      if (!graded.acceptable && result.ok) falseAccepts += 1;
    }

    expect({ falseRefusals, falseAccepts }).toEqual({ falseRefusals: 0, falseAccepts: 0 });
  });
});

describe('intent', () => {
  /**
   * The unrecoverable failure.
   *
   * A rewrite that drops what the prompt was about will be sent — the user does
   * not re-read closely enough to catch it — and the wrong answer gets blamed
   * on the model.
   */
  it.each(REFINE_FIXTURES)('keeps the subject of: $id', async (f) => {
    // Built from the text the model was actually given, not from the raw draft:
    // returning the user's unredacted secret is a response the guard rejects,
    // and rightly — but it would be rejected for the wrong reason here.
    scriptModel((prompt) => `Please help with the following. ${bodyOf(prompt)}`);

    const result = await refineWith(f.draft, f.styles[0]!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lower = result.text.toLowerCase();
    for (const term of f.mustKeep) {
      expect(lower, `${f.id}: ${f.intent}`).toContain(term.toLowerCase());
    }
  });

  it.each(REFINE_FIXTURES)('refuses a rewrite that drops the subject of: $id', async (f) => {
    scriptModel(() => 'Please help me with this thing when you have a moment today.');

    const result = await refineWith(f.draft, f.styles[0]!);

    // Either the intent check catches it or the length band does; both are
    // refusals, which is what the user experiences.
    expect(result.ok).toBe(false);
  });
});

describe('fabrication', () => {
  it.each(REFINE_FIXTURES)('refuses invented specifics in: $id', async (f) => {
    for (const invention of f.mustNotInvent) {
      __resetForTests();
      // Keeps the whole draft so only the invention differs — otherwise a
      // refusal could be down to lost intent instead.
      scriptModel((prompt) => `${bodyOf(prompt)}. Focus on ${invention}.`);

      const result = await refineWith(f.draft, f.styles[0]!);

      expect(result.ok, `${f.id}: invented "${invention}"`).toBe(false);
    }
  });

  it.each(REFINE_FIXTURES)('lets the diff catch what it cannot: $id', async (f) => {
    /*
     * The limit of the gate, asserted rather than assumed.
     *
     * A model turning "why is it slow" into "why is my database query slow" has
     * invented the subject using words indistinguishable from ordinary
     * rewriting. Claiming these were covered would be the more comfortable
     * choice and the wrong one — so the test records that they are not, which
     * is exactly why the user sees a diff before anything is sent.
     */
    let missed = 0;

    for (const invention of f.undetectable) {
      __resetForTests();
      scriptModel((prompt) => `${bodyOf(prompt)}. Focus on ${invention}.`);
      const result = await refineWith(f.draft, f.styles[0]!);
      if (result.ok) missed += 1;
    }

    expect(missed).toBeGreaterThan(0);
  });

  it('does not treat the user’s own specifics as fabrication', async () => {
    // A false refusal costs the user the feature. Anything they typed is theirs.
    const draft = 'update src/auth/login.ts to use v2.1.0 of the sdk, see getUserById()';
    scriptModel(
      () => 'Update src/auth/login.ts to use v2.1.0 of the SDK. See getUserById().',
    );

    const result = await refineWith(draft, 'clear');

    expect(result.ok).toBe(true);
  });

  it('does not treat a restored secret as fabrication', async () => {
    // The value is redacted on the way out and restored on the way back, so by
    // the time the gate sees it, it is the user's own text again.
    const f = fixture('with-secret');
    scriptModel((prompt) => {
      const body = /---\n([\s\S]*?)\n---/.exec(prompt)?.[1] ?? '';
      return `My deployment is failing. ${body}`;
    });

    const result = await refineWith(f.draft, 'clear');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain('AKIA3TZ2MRSYNTHETIC7');
  });
});

describe('length', () => {
  it('refuses an answer where a rewrite was asked for', async () => {
    // The most common model failure: it answers the prompt instead.
    const f = fixture('no-context-question');
    scriptModel(() => 'It is slow. '.repeat(60));

    const result = await refineWith(f.draft, 'clear');

    expect(result.ok).toBe(false);
  });

  it('allows a short draft to grow proportionally a lot', async () => {
    // "fix the login bug" is four words; a good rewrite is already several
    // times longer. Enforcing a ratio here would reject exactly the drafts
    // refinement helps most.
    scriptModel(
      () =>
        'Help me diagnose and fix a bug in the login flow. What are the most likely ' +
        'causes, and what should I check first?',
    );

    const result = await refineWith('fix the login bug', 'clear');

    expect(result.ok).toBe(true);
  });

  it('refuses a “shorter” rewrite that is longer', async () => {
    const f = fixture('padded-request');
    scriptModel(() => `${f.draft} ${f.draft} ${f.draft}`);

    const result = await refineWith(f.draft, 'concise');

    expect(result.ok).toBe(false);
  });
});

describe('latency', () => {
  /**
   * Everything except the model call.
   *
   * The model's own latency is hardware-dependent and cannot be asserted in
   * CI — that number comes from a device. What CI can hold is that our own
   * work around it stays negligible, so a slow refinement is always the
   * model's doing and never ours.
   */
  const OVERHEAD_BUDGET_MS = 150;

  it('adds negligible overhead on a large draft', async () => {
    const draft = 'please review this and tell me what is wrong with it. '.repeat(80);
    scriptModel(() => `${draft} Focus on correctness.`);

    // Warm the session so creation is not counted as per-call overhead.
    await refineWith(draft, 'clear');

    const started = performance.now();
    await refineWith(draft, 'clear');
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(OVERHEAD_BUDGET_MS);
  });

  it('allows longer than the model actually takes', async () => {
    // Set from measurement rather than taste: the slowest of 21 real on-device
    // refinements was 10.6s, so a budget under that would report successful
    // rewrites as failures. See on-device.test.ts.
    expect(REFINE_TIMEOUT_MS).toBeGreaterThan(15_000);
  });

  it('reports a timeout as a timeout, leaving the draft alone', async () => {
    scriptModel(() => 'too late', 5_000);

    const result = (await refine('fix the login bug', {
      timeoutMs: 20,
      rules: ALL_RULES,
    })) as Extract<RefineResult, { ok: false }>;

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('timeout');
    expect(result.message).toContain('unchanged');
  });
});

describe('the refusal rate', () => {
  /**
   * How often a plausible model response is refused.
   *
   * Recorded rather than gated. The number that matters comes from a real
   * model on real drafts; what this pins is that the corpus has not silently
   * become all-refusals or all-accepts, either of which would mean the gate
   * had stopped discriminating.
   */
  it('sits between the two useless extremes', async () => {
    let refusals = 0;

    for (const graded of GRADED_SUGGESTIONS) {
      __resetForTests();
      scriptModel((prompt) => fillPlaceholders(graded.suggestion, prompt));
      const result = await refineWith(fixture(graded.fixtureId).draft, graded.style);
      if (!result.ok) refusals += 1;
    }

    const rate = refusals / GRADED_SUGGESTIONS.length;

    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.8);
  });

  it('never leaves the user without an explanation', async () => {
    // A refusal that shows nothing is indistinguishable from a broken feature.
    for (const graded of GRADED_SUGGESTIONS.filter((s) => !s.acceptable)) {
      __resetForTests();
      scriptModel((prompt) => fillPlaceholders(graded.suggestion, prompt));
      const result = await refineWith(fixture(graded.fixtureId).draft, graded.style);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message.trim()).not.toBe('');
    }
  });
});

describe('the evaluator itself', () => {
  // Pinned directly, since the pipeline tests above would still pass if the
  // report said something different from what it decided on.
  it('reports what it measured, not just a verdict', () => {
    const report = evaluateRefinement(
      'fix the login bug',
      'Fix the authentication bug in src/auth.ts.',
      'clear',
    );

    expect(report.ok).toBe(false);
    expect(report.problems).toContain('fabricated-specifics');
    expect(report.invented).toContain('src/auth.ts');
    expect(report.intentRetention).toBeGreaterThan(0);
    expect(report.lengthRatio).toBeGreaterThan(0);
  });

  it('accepts an ordinary rewrite', () => {
    const report = evaluateRefinement(
      'fix the login bug',
      'Help me fix the bug in the login flow.',
      'clear',
    );

    expect(report).toMatchObject({ ok: true, problems: [] });
  });
});
