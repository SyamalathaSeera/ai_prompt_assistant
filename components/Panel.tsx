import { useEffect, useState } from 'preact/hooks';
import { ApprovalModal } from './ApprovalModal';
import { ClarifyQuestion } from './ClarifyQuestion';
import { ErrorBoundary } from './ErrorBoundary';
import { HealthNotice } from './HealthNotice';
import { RefineButton } from './RefineButton';
import { RefineReview } from './RefineReview';
import { RiskIndicator } from './RiskIndicator';
import { useAnchor } from './useAnchor';
import type { ClarifyStore } from './clarify-store';
import type { HealthLevel } from '@/lib/health';
import type { PanelState, PanelStore } from './panel-store';
import type { RefineStore } from './refine-store';
import type { RiskStore } from './risk-store';

/**
 * Root of the injected UI.
 *
 * Four surfaces, deliberately ordered by how much they demand of the user:
 *
 *   risk badge        always on, demands nothing
 *   refine button     always on, offers something
 *   clarify question  unsolicited, so it interrupts nothing and blocks nothing
 *   modals            appear only when a decision is required
 *
 * The shadow host covers the viewport so modals can be centred, but is
 * `pointer-events: none`; anything interactive opts back in explicitly, or the
 * panel would swallow every click on the page beneath it.
 */
interface Props {
  store: PanelStore;
  riskStore?: RiskStore;
  refineStore?: RefineStore;
  /** Absent unless the user has turned clarification on. */
  clarifyStore?: ClarifyStore;
  getComposer?: () => Element | null;
  /** False when the machine cannot run the on-device model. */
  refineAvailable?: boolean;
  /** Whether protection is actually working on this page. */
  health?: HealthLevel;
  /** Strategy that resolved the composer, shown only when degraded. */
  healthResolvedVia?: string | null;
  /**
   * Called when the injected UI crashes.
   *
   * The caller must stop intercepting and report protection unavailable — the
   * boundary has already dismissed the held submission, so the user's text is
   * safe in the composer, but nothing can be shown to them any more.
   */
  onUiError?: (error: unknown) => void;
}

/** Breathing room between the composer and anything anchored to it. */
const GAP = 8;

export function Panel({
  store,
  riskStore,
  refineStore,
  clarifyStore,
  getComposer,
  refineAvailable = false,
  health = 'healthy',
  healthResolvedVia = null,
  onUiError,
}: Props) {
  /**
   * A crash anywhere in the injected UI.
   *
   * Dismissing first is deliberate and is the whole safety argument: dismissal
   * leaves the user's text in the composer, unsent. Releasing would send the
   * original — secrets included — at precisely the moment we lost the ability
   * to warn them about it.
   */
  const handleUiError = (error: unknown) => {
    try {
      store.dismiss();
    } catch {
      /* the store is already unusable; the caller still needs telling */
    }
    onUiError?.(error);
  };
  const [state, setState] = useState<PanelState>(() => store.get());
  const [refineState, setRefineState] = useState(() => refineStore?.get());
  const [clarifyState, setClarifyState] = useState(() => clarifyStore?.get());

  useEffect(() => {
    // Re-read on subscribe. Effects run after render, so a submission held in
    // that window would otherwise never reach the UI — and the user would be
    // left staring at a prompt that silently refused to send.
    setState(store.get());
    return store.subscribe(setState);
  }, [store]);

  useEffect(() => {
    if (!refineStore) return;
    setRefineState(refineStore.get());
    return refineStore.subscribe(setRefineState);
  }, [refineStore]);

  useEffect(() => {
    if (!clarifyStore) return;
    setClarifyState(clarifyStore.get());
    return clarifyStore.subscribe(setClarifyState);
  }, [clarifyStore]);

  const anchor = useAnchor(getComposer ?? (() => null), [refineAvailable]);

  const modalOpen = state.kind === 'active';
  const reviewOpen = refineState?.phase === 'reviewing';
  const clarifyOpen = clarifyState?.phase === 'asking';

  // Only one thing at a time may ask for a decision. A refinement review over
  // a held submission would leave the user choosing between two questions
  // about the same prompt.
  const anyDialogOpen = modalOpen || reviewOpen;

  return (
    <div data-testid="apa-panel" className="contents">
      {/*
        Rendered before everything else and outside the dialog suppression:
        "you are not protected" outranks every other surface here, and it is
        the one message that must never be hidden behind something else.

        Deliberately OUTSIDE the error boundary too. If the boundary has caught
        a crash, this notice is the only thing left telling the user about it —
        putting it inside the thing that just broke would silence exactly the
        message that matters most.
      */}
      {health !== 'healthy' && (
        // Deliberately NOT gated on `anchor`. The composer being unfindable is
        // the very thing this reports, so requiring one to render would silence
        // the message in the only case that matters. It positions itself.
        <HealthNotice level={health} anchor={anchor} resolvedVia={healthResolvedVia} />
      )}

      {/*
        One boundary around every interactive surface.

        Not one per surface: a crash in any of them means the injected UI is
        not trustworthy, and the caller's response — stop holding submissions,
        report protection unavailable — is the same whichever one it was.
        Keeping some surfaces alive after a sibling crashed would leave the user
        with a half-working panel that still looks operational.
      */}
      <ErrorBoundary onError={handleUiError}>
        {riskStore && !anyDialogOpen && (
          <RiskIndicator store={riskStore} anchor={anchor} />
        )}

        {refineStore && anchor && !anyDialogOpen && (
          <RefineButton store={refineStore} anchor={anchor} available={refineAvailable} />
        )}

        {/*
          The approval modal wins if both could show. It is about a prompt
          already on its way out; a rewrite suggestion can wait.
        */}
        {modalOpen && state.kind === 'active' && (
          <ApprovalModal state={state} store={store} />
        )}

        {!modalOpen && reviewOpen && refineStore && refineState && (
          <RefineReview state={refineState} store={refineStore} />
        )}
      </ErrorBoundary>

      {/*
        Sits above the composer and never over it, so the user can keep typing
        and send with the question still on screen.

        Hidden while either modal is up — not because it competes for a
        decision, but because it would render underneath one and be unreachable.
        The store keeps its state, so the question is still there afterwards.
      */}
      <ErrorBoundary onError={handleUiError}>
        {clarifyOpen && clarifyStore && clarifyState && anchor && !anyDialogOpen && (
          <div
            className="pointer-events-none fixed flex justify-center"
            data-testid="apa-clarify-anchor"
            style={{
              left: `${Math.max(GAP, anchor.left)}px`,
              width: `${anchor.width}px`,
              bottom: `${Math.max(GAP, window.innerHeight - anchor.top + GAP)}px`,
            }}
          >
            <ClarifyQuestion state={clarifyState} store={clarifyStore} />
          </div>
        )}
      </ErrorBoundary>
    </div>
  );
}
