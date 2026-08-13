import { useEffect, useState } from 'preact/hooks';
import { ApprovalModal } from './ApprovalModal';
import { RiskIndicator } from './RiskIndicator';
import type { PanelState, PanelStore } from './panel-store';
import type { RiskStore } from './risk-store';

/**
 * Root of the injected UI.
 *
 * Two independent surfaces: the always-on risk badge, and the approval modal
 * that appears only when a submission is held.
 *
 * The shadow host covers the viewport so the modal can be centred in it, but
 * is `pointer-events: none`; anything interactive opts back in explicitly, or
 * the panel would swallow every click on the page beneath it.
 */
interface Props {
  store: PanelStore;
  riskStore?: RiskStore;
  getComposer?: () => Element | null;
}

export function Panel({ store, riskStore, getComposer }: Props) {
  const [state, setState] = useState<PanelState>(() => store.get());

  useEffect(() => {
    // Re-read on subscribe. Effects run after render, so a submission held in
    // that window would otherwise never reach the UI — and the user would be
    // left staring at a prompt that silently refused to send.
    setState(store.get());
    return store.subscribe(setState);
  }, [store]);

  const modalOpen = state.kind === 'active';

  return (
    <div data-testid="apa-panel" className="contents">
      {/*
        The badge is hidden while the modal is open. Two overlapping surfaces
        describing the same findings is noise, and the modal is the one
        demanding a decision.
      */}
      {riskStore && getComposer && !modalOpen && (
        <RiskIndicator store={riskStore} getComposer={getComposer} />
      )}

      {state.kind === 'active' && <ApprovalModal state={state} store={store} />}
    </div>
  );
}
