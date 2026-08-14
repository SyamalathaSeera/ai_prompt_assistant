import { useEffect, useState } from 'preact/hooks';
import { ApprovalModal } from './ApprovalModal';
import { ClarifyQuestion } from './ClarifyQuestion';
import { RefineButton } from './RefineButton';
import { RefineReview } from './RefineReview';
import { RiskIndicator } from './RiskIndicator';
import { useAnchor } from './useAnchor';
import type { ClarifyStore } from './clarify-store';
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
}: Props) {
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
      {riskStore && getComposer && !anyDialogOpen && (
        <RiskIndicator store={riskStore} getComposer={getComposer} />
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

      {/*
        Sits above the composer and never over it, so the user can keep typing
        and send with the question still on screen.

        Hidden while either modal is up — not because it competes for a
        decision, but because it would render underneath one and be unreachable.
        The store keeps its state, so the question is still there afterwards.
      */}
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
    </div>
  );
}
