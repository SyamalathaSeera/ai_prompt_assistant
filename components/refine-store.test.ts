import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefineStore, type RefineStore } from './refine-store';
import { __resetForTests } from '@/lib/model/session';
import { ALL_RULES } from '@/lib/detector/rules';

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';

/**
 * A draft with something to preserve.
 *
 * Suggestions in these tests have to survive the quality gate, which refuses a
 * rewrite that kept nothing of what the draft was about — so both sides are
 * about the same thing, the way a real pair would be.
 */
const ORIGINAL = 'fix the login bug';

function installModel(reply: (prompt: string) => string | Promise<string>) {
  vi.stubGlobal('LanguageModel', {
    availability: async () => 'available',
    create: async () => ({
      prompt: async (input: string) => reply(input),
      destroy: () => {},
    }),
  });
}

interface Harness {
  store: RefineStore;
  composer: () => string;
  setComposer: (text: string) => void;
}

function makeStore(initial = 'fix the bug'): Harness {
  let composerText = initial;

  const store = createRefineStore({
    getDraft: () => composerText,
    applyToComposer: (text) => {
      composerText = text;
    },
    rules: ALL_RULES,
  });

  return {
    store,
    composer: () => composerText,
    setComposer: (text) => {
      composerText = text;
    },
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  __resetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetForTests();
});

describe('invocation', () => {
  it('never runs on its own', async () => {
    // Rewriting what someone typed without being asked is presumptuous, and
    // unlike redaction there is no safety argument for doing it uninvited.
    const create = vi.fn();
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create });

    const { store } = makeStore();
    await new Promise((r) => setTimeout(r, 20));

    expect(create).not.toHaveBeenCalled();
    expect(store.get().phase).toBe('idle');
  });

  it('runs only when asked', async () => {
    installModel(() => 'Fix the authentication bug in the login handler.');
    const { store } = makeStore();

    await store.start();

    expect(store.get().phase).toBe('reviewing');
    expect(store.get().suggestion).toContain('authentication');
  });

  it('refuses an empty composer with something useful to read', async () => {
    installModel(() => 'anything');
    const { store } = makeStore('   ');

    await store.start();

    expect(store.get().phase).toBe('failed');
    expect(store.get().message).toBe('Type something first.');
  });
});

describe('accepting', () => {
  it('writes to the composer and does not submit', async () => {
    // The user asked for a better prompt, not for it to be sent.
    installModel(() => 'Help me find and fix the bug.');
    const h = makeStore();

    await h.store.start();
    h.store.accept();

    expect(h.composer()).toBe('Help me find and fix the bug.');
    expect(h.store.get().phase).toBe('idle');
  });

  it('can be undone, restoring exactly what was there', async () => {
    // Someone who accepts, reads it properly, and dislikes it should not have
    // to reconstruct their own wording from memory.
    installModel(() => 'Help me find and fix the bug.');
    const h = makeStore(ORIGINAL);

    await h.store.start();
    h.store.accept();
    expect(h.composer()).toBe('Help me find and fix the bug.');

    h.store.undo();

    expect(h.composer()).toBe(ORIGINAL);
  });

  it('sends the user’s edit rather than the suggestion', async () => {
    installModel(() => 'Fix the bug in the login flow.');
    const h = makeStore();

    await h.store.start();
    h.store.updateDraft('my own wording');
    h.store.accept();

    expect(h.composer()).toBe('my own wording');
  });

  it('marks the draft as edited once changed', async () => {
    installModel(() => 'Fix the bug in the login flow.');
    const { store } = makeStore();

    await store.start();
    expect(store.get().edited).toBe(false);

    store.updateDraft('changed');
    expect(store.get().edited).toBe(true);
  });
});

describe('discarding', () => {
  it('leaves the composer untouched', async () => {
    installModel(() => 'Help me find and fix the bug.');
    const h = makeStore(ORIGINAL);

    await h.store.start();
    h.store.dismiss();

    expect(h.composer()).toBe(ORIGINAL);
    expect(h.store.get().phase).toBe('idle');
  });
});

describe('secrets', () => {
  it('never sends the raw draft to the model', async () => {
    const seen: string[] = [];
    installModel((prompt) => {
      seen.push(prompt);
      return 'Fix this. My key is in the environment.';
    });

    const h = makeStore(`fix this, key is ${AWS_KEY}`);
    await h.store.start();

    expect(seen[0]).not.toContain(AWS_KEY);
  });

  it('shows the suggestion with real values restored', async () => {
    // A diff full of [REDACTED_AWS_KEY_1] would obscure what actually changed.
    installModel((prompt) => {
      const match = /---\n([\s\S]*?)\n---/.exec(prompt);
      return `Please ${match?.[1] ?? ''}`;
    });

    const h = makeStore(`fix this, key is ${AWS_KEY}`);
    await h.store.start();

    expect(h.store.get().suggestion).toContain(AWS_KEY);
  });
});

describe('cancellation', () => {
  it('discards a superseded request', async () => {
    // A suggestion for text the user has already rewritten is worse than no
    // suggestion.
    let firstStarted!: () => void;
    const firstInFlight = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    let call = 0;

    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: async () => ({
        prompt: (_input: string, options?: { signal?: AbortSignal }) => {
          call += 1;
          if (call > 1) return Promise.resolve('Fix the second bug.');

          firstStarted();
          // A real model rejects when its signal aborts. The mock must too, or
          // the test would prove nothing about what supersession costs.
          return new Promise<string>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          });
        },
        destroy: () => {},
      }),
    });

    const { store } = makeStore();

    const first = store.start();
    await firstInFlight;
    const second = store.start();

    await Promise.all([first, second]);

    expect(store.get().phase).toBe('reviewing');
    expect(store.get().suggestion).toBe('Fix the second bug.');
  });

  it('returns to idle on cancel without reporting an error', async () => {
    installModel(
      () => new Promise<string>(() => {}),
    );
    const { store } = makeStore();

    const pending = store.start();
    store.cancel();
    await pending;

    expect(store.get().phase).toBe('idle');
    expect(store.get().message).toBe('');
  });
});

describe('failure', () => {
  it('leaves the draft alone and explains why', async () => {
    // No model available at all.
    const h = makeStore(ORIGINAL);

    await h.store.start();

    expect(h.composer()).toBe(ORIGINAL);
    expect(h.store.get().phase).toBe('failed');
    expect(h.store.get().message).toContain('not available');
  });

  it('reports an unchanged rewrite rather than showing an empty diff', async () => {
    installModel(() => 'fix the bug');
    const { store } = makeStore('fix the bug');

    await store.start();

    expect(store.get().phase).toBe('failed');
    expect(store.get().message).toContain('already reads clearly');
  });
});

describe('style', () => {
  it('reports the chosen style for saving', () => {
    const onStyleChange = vi.fn();
    const store = createRefineStore({
      getDraft: () => 'x',
      applyToComposer: () => {},
      onStyleChange,
      rules: ALL_RULES,
    });

    store.setStyle('concise');

    expect(onStyleChange).toHaveBeenCalledWith('concise');
    expect(store.get().style).toBe('concise');
  });

  it('starts from the style the user last chose', () => {
    // The choice is a habit, not a per-prompt decision.
    const store = createRefineStore({
      getDraft: () => 'x',
      applyToComposer: () => {},
      initialStyle: 'technical',
      rules: ALL_RULES,
    });

    expect(store.get().style).toBe('technical');
  });

  it('keeps the chosen style after a suggestion is accepted', async () => {
    // Resetting here would silently undo the preference: it would appear to
    // save, and then not.
    installModel(() => 'Help me find and fix the bug.');
    const h = makeStore();

    h.store.setStyle('concise');
    await h.store.start();
    h.store.accept();

    expect(h.store.get().phase).toBe('idle');
    expect(h.store.get().style).toBe('concise');
  });

  it('keeps the chosen style after dismissing and after failing', async () => {
    installModel(() => 'Help me find and fix the bug.');
    const h = makeStore();

    h.store.setStyle('beginner');
    await h.store.start();
    h.store.dismiss();
    expect(h.store.get().style).toBe('beginner');

    vi.unstubAllGlobals();
    __resetForTests();
    await h.store.start();

    expect(h.store.get().phase).toBe('failed');
    expect(h.store.get().style).toBe('beginner');
  });

  it('uses the style it was asked for, not the remembered one', async () => {
    // The picker both sets the style and runs with it in one press.
    const seen: string[] = [];
    installModel((prompt) => {
      seen.push(prompt);
      return 'Help me find and fix the bug.';
    });
    const h = makeStore();

    await h.store.start('concise');

    expect(seen[0]).toContain('fewer words');
  });
});
