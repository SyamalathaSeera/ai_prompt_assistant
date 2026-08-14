import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { ClarifyQuestion } from './ClarifyQuestion';
import { createClarifyStore, type ClarifyStore } from './clarify-store';
import { __resetForTests } from '@/lib/model/session';
import { ALL_RULES } from '@/lib/detector/rules';
import type { ContextTurn } from '@/lib/clarify';

/**
 * Clarification, exercised through the store and the question together.
 *
 * The properties that matter here are not about rendering. They are about what
 * reaches the composer and when — so almost every test below is really asking
 * the same question: did anything change without the user saying yes?
 */

const AWS_KEY = 'AKIA3TZ2MRSYNTHETIC7';

const TURNS: ContextTurn[] = [
  { role: 'user', text: 'I am working on the login form', id: 'm1' },
  { role: 'assistant', text: 'The settings page uses a different layout', id: 'm2' },
];

const RESOLVED = 'add the login form to the settings page';

let container: HTMLElement;
let store: ClarifyStore;
let composerText: string;
let draft: string;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const $$ = (id: string) =>
  [...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const waitFor = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000 });

function installModel(reply: () => string) {
  const calls: string[] = [];

  vi.stubGlobal('LanguageModel', {
    availability: async () => 'available',
    create: async () => ({
      prompt: async (input: string) => {
        calls.push(input);
        return reply();
      },
      destroy: () => {},
    }),
  });

  return { calls };
}

function mount(turns: readonly ContextTurn[] = TURNS) {
  store = createClarifyStore({
    getDraft: () => draft,
    applyToComposer: (text) => {
      composerText = text;
    },
    getTurns: () => turns,
    getConversationId: () => 'c1',
    rules: ALL_RULES,
  });

  const paint = () => render(<ClarifyQuestion state={store.get()} store={store} />, container);
  store.subscribe(paint);
  paint();
}

beforeEach(() => {
  vi.unstubAllGlobals();
  __resetForTests();
  container = document.createElement('div');
  document.body.append(container);
  draft = 'add this over there';
  composerText = 'UNTOUCHED';
});

afterEach(() => {
  render(null, container);
  container.remove();
  vi.unstubAllGlobals();
  __resetForTests();
});

describe('nothing is substituted without confirmation', () => {
  it('leaves the composer alone while the question is showing', async () => {
    installModel(() => RESOLVED);
    mount();

    await store.consider();
    await waitFor(() => expect($('apa-clarify')).not.toBeNull());

    // The interpretation is on screen and the composer still holds the
    // user's own words.
    expect($('apa-clarify-suggestion')?.textContent).toContain('login form');
    expect(composerText).toBe('UNTOUCHED');
  });

  it('writes to the composer only when the user says yes', async () => {
    installModel(() => RESOLVED);
    mount();

    await store.consider();
    await waitFor(() => expect($('apa-clarify-accept')).not.toBeNull());

    $('apa-clarify-accept')?.click();

    expect(composerText).toBe(RESOLVED);
  });

  it('accepting does not submit', async () => {
    // The user confirmed an interpretation, not that they were finished.
    const submitted = vi.fn();
    document.addEventListener('submit', submitted);

    installModel(() => RESOLVED);
    mount();
    await store.consider();
    await waitFor(() => expect($('apa-clarify-accept')).not.toBeNull());
    $('apa-clarify-accept')?.click();

    expect(submitted).not.toHaveBeenCalled();
    document.removeEventListener('submit', submitted);
  });

  it('sends what the user edited, not what the model said', async () => {
    installModel(() => RESOLVED);
    mount();
    await store.consider();
    await waitFor(() => expect($('apa-clarify-edit-toggle')).not.toBeNull());

    $('apa-clarify-edit-toggle')?.click();
    store.updateDraft('add the login form to the billing page');
    $('apa-clarify-accept')?.click();

    expect(composerText).toBe('add the login form to the billing page');
  });
});

describe('declining', () => {
  it('sends the original exactly', async () => {
    installModel(() => RESOLVED);
    mount();
    await store.consider();
    await waitFor(() => expect($('apa-clarify-decline')).not.toBeNull());

    $('apa-clarify-decline')?.click();

    expect(composerText).toBe('UNTOUCHED');
    expect(draft).toBe('add this over there');
    expect($('apa-clarify')).toBeNull();
  });

  it('does not ask again for the same draft', async () => {
    installModel(() => RESOLVED);
    mount();

    await store.consider();
    await waitFor(() => expect($('apa-clarify-decline')).not.toBeNull());
    $('apa-clarify-decline')?.click();

    // Same text, asked again. Nagging is the fastest way to make someone turn
    // a feature off.
    await store.consider();

    expect($('apa-clarify')).toBeNull();
    expect(store.hasDeclined('add this over there')).toBe(true);
  });

  it('ignores whitespace differences when remembering a decline', async () => {
    installModel(() => RESOLVED);
    mount();
    await store.consider();
    await waitFor(() => expect($('apa-clarify-decline')).not.toBeNull());
    $('apa-clarify-decline')?.click();

    draft = '  add this   over there  ';
    await store.consider();

    expect($('apa-clarify')).toBeNull();
  });

  it('will still ask about a genuinely different draft', async () => {
    // The reply tracks the draft's own verb. A canned "add the login form…"
    // against a draft that says "move" is a rewrite, not a resolution, and the
    // quality gate would rightly refuse it — which would make this test pass
    // for the wrong reason.
    installModel(() => draft.replace('this over there', 'the login form to the settings page'));
    mount();
    await store.consider();
    await waitFor(() => expect($('apa-clarify-decline')).not.toBeNull());
    $('apa-clarify-decline')?.click();

    draft = 'move this over there';
    await store.consider();

    await waitFor(() => expect($('apa-clarify')).not.toBeNull());
  });
});

describe('showing where an interpretation came from', () => {
  it('names the source turn for each resolution', async () => {
    installModel(() => RESOLVED);
    mount();
    await store.consider();
    await waitFor(() => expect($('apa-clarify-sources')).not.toBeNull());

    const sources = $$('apa-clarify-source');
    expect(sources.length).toBeGreaterThan(0);

    for (const source of sources) {
      // Every resolution points at a real turn, and says which.
      const index = Number(source.dataset.turnIndex);
      expect(TURNS[index]).toBeDefined();
      expect(source.textContent).toMatch(/your message|the reply/);
    }
  });

  it('quotes the turn so a wrong guess is obvious', async () => {
    installModel(() => RESOLVED);
    mount();
    await store.consider();
    await waitFor(() => expect($('apa-clarify-sources')).not.toBeNull());

    expect($('apa-clarify-sources')?.textContent).toContain('login form');
  });

  it('redacts a secret out of the quoted turn', async () => {
    /*
     * The excerpt is text already on the user's screen, so quoting it reveals
     * nothing new — but it lands in our own DOM, and a product whose claim is
     * that it does not put your secrets anywhere should not make an exception
     * for its own UI.
     */
    installModel(() => RESOLVED);
    mount([
      { role: 'user', text: `I am working on the login form, key ${AWS_KEY}`, id: 'm1' },
      TURNS[1]!,
    ]);

    await store.consider();
    await waitFor(() => expect($('apa-clarify-sources')).not.toBeNull());

    expect(container.textContent).not.toContain(AWS_KEY);
  });
});

describe('restraint', () => {
  it('stops offering after two unaccepted offers in a conversation', async () => {
    /*
     * The failure mode for this feature is not being wrong — it is being
     * frequent. Two ignored offers is an answer.
     */
    installModel(() => draft.replace('this over there', 'the login form to the settings page'));
    mount();

    await store.consider();
    await waitFor(() => expect($('apa-clarify')).not.toBeNull());
    store.cancel();

    draft = 'move this over there';
    await store.consider();
    await waitFor(() => expect($('apa-clarify')).not.toBeNull());
    store.cancel();

    // Third time: silence, for the rest of this conversation.
    draft = 'put this over there';
    await store.consider();

    expect($('apa-clarify')).toBeNull();
  });

  it('counts an offer that was ignored, not only one that was refused', async () => {
    // Someone quietly scrolling past is telling us the same thing as someone
    // clicking No, and only counting the clicks would let it keep interrupting.
    const { calls } = installModel(() =>
      draft.replace('this over there', 'the login form to the settings page'),
    );
    mount();

    await store.consider();
    await waitFor(() => expect($('apa-clarify')).not.toBeNull());

    // No decline, no cancel — the offer is simply superseded.
    draft = 'move this over there';
    await store.consider();
    await waitFor(() => expect($('apa-clarify')).not.toBeNull());

    draft = 'put this over there';
    await store.consider();

    /*
     * The rate limit means no NEW offer, not that the pending one is snatched
     * away — so what is asserted is that nothing further was computed. The
     * check runs before any work, so a rate-limited conversation costs not
     * even a model call.
     */
    expect(calls).toHaveLength(2);
    expect(store.get().original).toBe('move this over there');
  });

  it('starts the budget again once an offer is accepted', async () => {
    installModel(() => draft.replace('this over there', 'the login form to the settings page'));
    mount();

    await store.consider();
    await waitFor(() => expect($('apa-clarify-accept')).not.toBeNull());
    $('apa-clarify-accept')?.click();

    // An acceptance is the signal that the offers are landing.
    draft = 'move this over there';
    await store.consider();
    await waitFor(() => expect($('apa-clarify')).not.toBeNull());

    draft = 'put this over there';
    await store.consider();
    await waitFor(() => expect($('apa-clarify')).not.toBeNull());
  });

  it('refuses a half-resolved interpretation', async () => {
    /*
     * "add the login form over there" is a worse thing to show someone than
     * the draft they wrote: they were comfortable with the ambiguity, and now
     * they are being asked to evaluate a sentence that resolved one half of it.
     */
    installModel(() => 'add the login form over there');
    mount();

    await store.consider();

    expect($('apa-clarify')).toBeNull();
  });
});

describe('staying out of the way', () => {
  it('is not a modal', async () => {
    // No backdrop, no focus trap, no aria-modal. Someone who ignores this
    // should be able to carry on typing and send.
    installModel(() => RESOLVED);
    mount();
    await store.consider();
    await waitFor(() => expect($('apa-clarify')).not.toBeNull());

    expect(container.querySelector('[aria-modal]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect($('apa-clarify')?.getAttribute('role')).toBe('region');
  });

  it('shows nothing when the model is unavailable', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    mount();

    await store.consider();

    // Silent. This is an offer, not a request — a failure costs nothing.
    expect($('apa-clarify')).toBeNull();
  });

  it('shows nothing when the interpretation invents something', async () => {
    installModel(() => 'add the payment webhook to the billing dashboard');
    mount();

    await store.consider();

    expect($('apa-clarify')).toBeNull();
  });

  it('shows nothing on a fresh chat', async () => {
    installModel(() => RESOLVED);
    mount([]);

    await store.consider();

    expect($('apa-clarify')).toBeNull();
  });

  it('drops the offer when the draft moved while it was thinking', async () => {
    /*
     * A question about words that are no longer on screen is worse than no
     * question at all.
     */
    installModel(() => RESOLVED);
    mount();

    const pending = store.consider();
    draft = 'something else entirely';
    await pending;

    expect($('apa-clarify')).toBeNull();
  });
});
