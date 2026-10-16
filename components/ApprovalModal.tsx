import { useRef, useState } from 'preact/hooks';
import { FindingList } from './FindingList';
import type { PanelState, PanelStore } from './panel-store';
import { summarize } from './summarize';
import { useFocusTrap } from './useFocusTrap';

/**
 * The approval modal.
 *
 * Appears at the moment someone is trying to do something else, so it is built
 * to be resolved in about three seconds: what was found, what will be sent
 * instead, and three unambiguous ways out.
 *
 * "Send anyway" is visually secondary but always genuinely available. A tool
 * that can trap a prompt it disagrees with gets uninstalled, and then it
 * protects nobody — the user's judgement has to win.
 */

interface Props {
  state: Extract<PanelState, { kind: 'active' }>;
  store: PanelStore;
}

export function ApprovalModal({ state, store }: Props) {
  const { submission, redactedText, draft, phase } = state;
  const busy = phase === 'applying';

  const dialogRef = useRef<HTMLDivElement>(null);
  const [confirmingOriginal, setConfirmingOriginal] = useState(false);

  // Confines Tab to the dialog and returns focus to the composer on close.
  useFocusTrap(dialogRef, true);

  /**
   * Escape dismisses. It does NOT send — see PanelStore.dismiss for why.
   *
   * Bound declaratively rather than through a ref and an effect: this way it
   * is attached the moment the element exists, with no window in which the
   * modal is on screen but not yet listening.
   */
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    store.dismiss();
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 flex items-center justify-center bg-black/40 p-4"
      data-testid="apa-modal-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="apa-modal-title"
        aria-describedby="apa-modal-summary"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="apa-modal"
        className="w-full max-w-lg rounded-xl border p-5 shadow-2xl outline-none"
        style={{
          background: 'var(--apa-bg)',
          color: 'var(--apa-fg)',
          borderColor: 'var(--apa-border)',
          boxShadow: 'var(--apa-shadow)',
        }}
      >
        <h2 id="apa-modal-title" className="text-base font-semibold tracking-tight">
          Sensitive data in this prompt
        </h2>

        {/*
          role="status" so assistive technology announces the count when the
          dialog opens, and again if the user toggles findings. The dialog's
          aria-describedby also points here, so it is read on focus.
        */}
        <p
          id="apa-modal-summary"
          role="status"
          className="mt-1 text-sm"
          style={{ color: 'var(--apa-muted)' }}
          data-testid="apa-modal-summary"
        >
          Found {summarize(submission.blocking)}. Nothing has been sent.
        </p>

        {state.error && <p role="alert" className="mt-2 text-sm">{state.error}</p>}
        <FindingList state={state} store={store} />

        {phase === 'editing' ? (
          <textarea
            data-testid="apa-edit-field"
            className="mt-4 h-40 w-full resize-y rounded-md border p-2 font-mono text-xs"
            style={{
              background: 'var(--apa-surface)',
              color: 'var(--apa-fg)',
              borderColor: 'var(--apa-border)',
            }}
            value={draft}
            onInput={(event) =>
              store.updateDraft((event.currentTarget as HTMLTextAreaElement).value)
            }
          />
        ) : (
          <pre
            data-testid="apa-preview"
            className="mt-4 max-h-40 overflow-auto rounded-md border p-2 font-mono text-xs whitespace-pre-wrap"
            style={{
              background: 'var(--apa-surface)',
              borderColor: 'var(--apa-border)',
            }}
          >
            {redactedText}
          </pre>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="apa-send-redacted"
            disabled={busy}
            onClick={() => (phase === 'editing' ? store.sendEdited() : store.sendRedacted())}
            className="rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--apa-accent)', color: 'var(--apa-accent-fg)' }}
          >
            {phase === 'editing' ? 'Send edited' : 'Send redacted'}
          </button>

          {phase !== 'editing' && (
            <button
              type="button"
              data-testid="apa-edit"
              disabled={busy}
              onClick={() => store.startEditing()}
              className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              style={{ borderColor: 'var(--apa-border)', color: 'var(--apa-fg)' }}
            >
              Edit
            </button>
          )}

          <span className="grow" />

          {/*
            Send-anyway takes two clicks. Not a dialog — that would be
            obstruction — but enough friction that it cannot happen by reflex
            while dismissing something.
          */}
          {confirmingOriginal ? (
            <button
              type="button"
              data-testid="apa-send-original-confirm"
              disabled={busy}
              onClick={() => store.sendOriginal()}
              className="rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
              style={{ background: 'var(--apa-danger-bg)', color: 'var(--apa-danger)' }}
            >
              Really send unredacted
            </button>
          ) : (
            <button
              type="button"
              data-testid="apa-send-original"
              disabled={busy}
              onClick={() => setConfirmingOriginal(true)}
              className="rounded-md px-3 py-2 text-sm underline-offset-2 hover:underline disabled:opacity-50"
              style={{ color: 'var(--apa-muted)' }}
            >
              Send anyway
            </button>
          )}

          <button
            type="button"
            data-testid="apa-dismiss"
            disabled={busy}
            onClick={() => store.dismiss()}
            className="rounded-md px-3 py-2 text-sm disabled:opacity-50"
            style={{ color: 'var(--apa-muted)' }}
          >
            Cancel
          </button>
        </div>

        <p className="mt-3 text-xs" style={{ color: 'var(--apa-muted)' }}>
          Nothing has been sent yet. Detection runs entirely on this device.
        </p>
      </div>
    </div>
  );
}
