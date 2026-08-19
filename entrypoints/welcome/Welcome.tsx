import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApprovalModal } from '@/components/ApprovalModal';
import { ModelDownload } from '@/components/ModelDownload';
import { PrivacyStatement } from '@/components/PrivacyStatement';
import { createPanelStore, type PanelState, type PanelStore } from '@/components/panel-store';
import { detect } from '@/lib/detector/engine';
import { getModelFeatures, type ModelFeatures } from '@/lib/model';
import { getSettings } from '@/lib/storage';
import { detectTheme, observeTheme } from '@/components/theme';
import type { HeldSubmission } from '@/lib/interception/controller';
import type { Settings } from '@/lib/policy/schema';

/**
 * The first-run page.
 *
 * A passive security tool has a structural problem: when it works, nothing
 * happens. Someone who installs this, sees no change, and forgets about it will
 * remove it in a fortnight — and the PRD's week-4 retention target is what this
 * page exists to move.
 *
 * The answer is not to explain what the extension does. It is to **make it
 * happen once, on purpose, before the user is anywhere near a real
 * conversation.** By the time they open ChatGPT they should already have
 * watched a secret get caught.
 *
 * So the demo below runs the **real detector**, feeds a **real panel store**,
 * and renders the **real approval modal** — the same components the content
 * script mounts. Not a video, not a screenshot, not a mock with a canned
 * finding list. The one thing that is simulated is the submission itself, since
 * there is no chat here to submit to; everything the user sees and clicks is
 * the production path.
 */

/**
 * The sample draft.
 *
 * Every value is synthetic and says so. `SYNTHETIC` sits inside the AWS key
 * where a real one would carry entropy, and the host is `db.internal` — a name
 * that resolves nowhere. Onboarding is a poor moment to teach someone that this
 * tool wants real credentials pasted into it, and a demo carrying a plausible
 * live key would be a liability in every screenshot anyone ever took of it.
 *
 * Two findings rather than one, because a single row does not show that the
 * list is a list — and because the second is a connection string, which is
 * where the "keeps the request readable" property becomes visible: the
 * surrounding URL survives while the password does not.
 */
const SAMPLE = `Deploy the billing service for me. Use AWS key AKIA3TZ2MRSYNTHETIC7 and connect to postgres://app:hunter2pass@db.internal:5432/orders`;

type Outcome =
  | { kind: 'none' }
  | { kind: 'sent'; text: string; redacted: boolean }
  | { kind: 'dismissed' };

/**
 * What this machine can and cannot run.
 *
 * Prompt improvement is the one part of this product that can be simply
 * **absent**. It needs Chrome's on-device model, which is not on every machine
 * — and `getModelFeatures()` hides the composer button rather than disabling
 * it, because a control that can never be enabled is an unanswered question in
 * the interface.
 *
 * Hiding it silently has a cost this page is the right place to pay. Someone
 * who read the store listing, installed, and then found no Improve button has
 * no way to tell a missing feature from a broken one — and "it doesn't work"
 * is exactly the review a launch cannot afford. Saying which of the three
 * states they are in, before they go looking, turns a defect into a fact.
 *
 * The wording is taken from `getModelFeatures()` rather than restated here.
 * Two copies of an explanation become two different explanations the first
 * time either is edited, and the stale one would be a lie — the same reason
 * `PrivacyStatement` is a shared component instead of duplicated copy.
 *
 * The download is offered here, not just linked to. This page was originally
 * built to send the user to settings instead, on the reasoning that a second
 * entry point meant a second copy of the progress and failure states and that
 * onboarding was the wrong moment to ask for gigabytes. The first half was
 * right and is answered by sharing `ModelDownload` rather than copying it.
 * The second was wrong in the only case that matters: this page is exactly
 * where someone learns the feature is missing, and telling them so while
 * handing them a link somewhere else is the dead end the control exists to
 * prevent. It is still a button and never automatic, so nobody spends a byte
 * they did not choose to.
 */
function ModelNote() {
  const [features, setFeatures] = useState<ModelFeatures | null>(null);

  const refresh = useCallback(() => {
    void getModelFeatures().then(setFeatures);
  }, []);

  useEffect(refresh, [refresh]);

  // Nothing until the answer is known. A flash of "your browser cannot run
  // this" that resolves into "ready" reads as a fault in the product.
  if (!features) return null;

  return (
    <section className="mt-10" data-testid="welcome-model-note">
      <h2 className="text-sm font-medium">One part depends on your computer</h2>

      <p className="mt-2 text-xs" style={{ color: 'var(--apa-muted)' }}>
        The extension can also rewrite a rough prompt into a clearer one, using an AI
        model that runs on your own machine — there is no key to enter and no account
        to make. Everything you have just seen works without it.
      </p>

      <p
        className="mt-2 text-xs"
        data-testid="welcome-model-state"
        style={{ color: 'var(--apa-muted)' }}
      >
        {features.canRunNow ? (
          <>
            Your browser can run it. Look for <strong>Improve</strong> above the message
            box, or press Alt+Shift+I.
          </>
        ) : (
          features.explanation
        )}
      </p>

      {features.needsDownload && (
        <div className="mt-3">
          <ModelDownload onSettled={refresh} />
        </div>
      )}
    </section>
  );
}

export function Welcome() {
  const [draft, setDraft] = useState(SAMPLE);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'none' });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [state, setState] = useState<PanelState>({ kind: 'idle' });
  const textarea = useRef<HTMLTextAreaElement>(null);

  /*
   * A real store, not a stub.
   *
   * Every decision the modal offers — toggle a value, allowlist it, edit before
   * sending, send anyway — runs the production state machine. If any of that
   * were faked here, the demo could keep working after the real thing broke.
   */
  const store: PanelStore = useMemo(
    () => createPanelStore({}),
    [],
  );

  /*
   * Subscribe with a fresh closure, not with `setState` itself.
   *
   * The store keeps listeners in a `Set` and unsubscribes by identity. Passing
   * the state setter directly means subscribe and unsubscribe use the *same*
   * identity — so if the effect ever runs twice, the first run's cleanup
   * deletes the entry the second run just added, and the component is left
   * silently unsubscribed from a store that is working perfectly.
   *
   * That is exactly what happened here: the store reached `active` and the
   * modal never appeared. An inline arrow gives each subscription its own
   * identity, so a stale cleanup can only remove its own.
   */
  useEffect(() => {
    setState(store.get());
    return store.subscribe((next) => setState(next));
  }, [store]);

  useEffect(() => {
    void getSettings().then(setSettings);

    document.documentElement.setAttribute('data-theme', detectTheme());
    return observeTheme((theme) =>
      document.documentElement.setAttribute('data-theme', theme),
    );
  }, []);

  /** Runs the real detector over the draft and opens the real modal. */
  const tryIt = () => {
    setOutcome({ kind: 'none' });

    const findings = detect(draft, {
      disabledRuleIds: settings?.disabledRuleIds,
      placeholderStyle: settings?.placeholderStyle,
    });
    const blocking = findings.filter((f) => f.tier === 'high');

    if (blocking.length === 0) {
      // Honest about a clean draft rather than manufacturing a catch. Someone
      // who edits the sample down to nothing should see the real answer.
      setOutcome({ kind: 'sent', text: draft, redacted: false });
      return;
    }

    /*
     * The one simulated piece: there is no chat to submit to, so the send
     * callbacks record what *would* have gone instead of releasing an event.
     * The text they receive is produced by the real redaction path.
     */
    const submission: HeldSubmission = {
      text: draft,
      findings,
      blocking,
      held: true,
      sendOriginal: () => setOutcome({ kind: 'sent', text: draft, redacted: false }),
      sendReplacement: (replacement) =>
        setOutcome({ kind: 'sent', text: replacement, redacted: true }),
      cancel: () => setOutcome({ kind: 'dismissed' }),
    };

    store.present(submission);
  };

  const openChatGPT = () => {
    window.open('https://chatgpt.com/', '_blank', 'noopener');
  };

  return (
    <main className="mx-auto max-w-2xl p-6 pb-24">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">You're protected.</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--apa-muted)' }}>
          Nothing to sign up for and nothing to configure. Here is what it does —
          try it right now, it takes about ten seconds.
        </p>
      </header>

      <section className="mt-8" data-testid="welcome-demo">
        <h2 className="text-sm font-medium">
          <span
            className="mr-2 inline-flex size-5 items-center justify-center rounded-full text-xs"
            style={{ background: 'var(--apa-accent)', color: 'var(--apa-accent-fg)' }}
          >
            1
          </span>
          {/*
            No count in the copy. The detector decides how many findings this
            sample produces — it currently finds three, including the internal
            hostname — and a hard-coded number would go stale the first time a
            rule changed.
          */}
          A message with secrets in it
        </h2>

        <p className="mt-2 text-xs" style={{ color: 'var(--apa-muted)' }}>
          This is a real message box running the real checker. Press the button —
          or edit the text first and see what it makes of yours.
        </p>

        <textarea
          ref={textarea}
          data-testid="welcome-composer"
          aria-label="Sample message"
          className="mt-3 h-28 w-full resize-y rounded-lg border p-3 font-mono text-xs"
          style={{
            background: 'var(--apa-surface)',
            color: 'var(--apa-fg)',
            borderColor: 'var(--apa-border)',
          }}
          value={draft}
          onInput={(event) => {
            setDraft((event.currentTarget as HTMLTextAreaElement).value);
            setOutcome({ kind: 'none' });
          }}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="welcome-try"
            onClick={tryIt}
            className="rounded-md px-3 py-2 text-sm font-medium"
            style={{ background: 'var(--apa-accent)', color: 'var(--apa-accent-fg)' }}
          >
            Send it
          </button>

          <span className="text-xs" style={{ color: 'var(--apa-muted)' }}>
            Nothing is actually sent. This page is offline.
          </span>
        </div>

        {outcome.kind === 'sent' && (
          <div
            data-testid="welcome-outcome"
            className="mt-4 rounded-lg border p-3"
            style={{
              borderColor: 'var(--apa-border)',
              background: 'var(--apa-surface)',
            }}
          >
            <p className="text-xs font-medium">
              {outcome.redacted ? 'This is what would have been sent:' : 'Sent as written:'}
            </p>
            <p
              data-testid="welcome-outcome-text"
              className="mt-2 font-mono text-xs break-words"
            >
              {outcome.text}
            </p>
            {outcome.redacted && (
              <p className="mt-2 text-xs" style={{ color: 'var(--apa-muted)' }}>
                The request still reads normally — only the values changed. When the
                reply mentions a placeholder, your real value is put back, here on
                your machine.
              </p>
            )}
          </div>
        )}

        {outcome.kind === 'dismissed' && (
          <p
            data-testid="welcome-outcome"
            className="mt-4 text-xs"
            style={{ color: 'var(--apa-muted)' }}
          >
            Nothing was sent, and your message is still there to edit. That is what
            closing the box always does.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium">
          <span
            className="mr-2 inline-flex size-5 items-center justify-center rounded-full text-xs"
            style={{ background: 'var(--apa-accent)', color: 'var(--apa-accent-fg)' }}
          >
            2
          </span>
          Now try it where you actually work
        </h2>

        <p className="mt-2 text-xs" style={{ color: 'var(--apa-muted)' }}>
          Open ChatGPT and start typing. A small badge appears near the message box
          when something looks sensitive — that is how you know it is watching.
        </p>

        <button
          type="button"
          data-testid="welcome-open-chatgpt"
          onClick={openChatGPT}
          className="mt-3 rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--apa-border)', color: 'var(--apa-fg)' }}
        >
          Open ChatGPT
        </button>

        <p className="mt-3 text-xs" style={{ color: 'var(--apa-muted)' }}>
          Claude and Gemini are supported too, and are off until you turn them on in
          settings — so the extension only ever asks for the access you have chosen
          to give it.
        </p>
      </section>

      {/*
        Placed after the two steps and before the privacy statement: it is an
        aside about this machine, not a step in the walkthrough, so it carries
        no number. It sits ahead of the privacy section because "runs on your
        own machine" is a claim that section then substantiates.
      */}
      <ModelNote />

      <section className="mt-10">
        <h2 className="text-sm font-medium">
          <span
            className="mr-2 inline-flex size-5 items-center justify-center rounded-full text-xs"
            style={{ background: 'var(--apa-accent)', color: 'var(--apa-accent-fg)' }}
          >
            3
          </span>
          What happens to what you type
        </h2>

        <p className="mt-2 mb-4 text-xs" style={{ color: 'var(--apa-muted)' }}>
          You just handed a tool permission to read everything you write to an AI.
          Here is exactly what it does with that, and how to check.
        </p>

        {/*
          The same component the options page renders. One statement, in one
          place — two copies would become two statements the first time either
          was edited, and the stale one would be a lie.
        */}
        <PrivacyStatement />
      </section>

      {/*
        The modal renders at the end so it layers over everything, exactly as it
        does on a real page.
      */}
      {state.kind === 'active' && <ApprovalModal state={state} store={store} />}
    </main>
  );
}

export default Welcome;
