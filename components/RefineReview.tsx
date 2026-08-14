import { useEffect, useRef, useState } from 'preact/hooks';
import { changeRatio, diffWords } from './diff';
import type { RefineState, RefineStore } from './refine-store';
import { useFocusTrap } from './useFocusTrap';

/**
 * The refinement review.
 *
 * Shows what changed, and offers Accept, Edit, Discard. Discard is what
 * Escape does, because a suggestion the user waves away should not be applied
 * — the same default as the approval modal, for the same reason.
 *
 * Accepting writes to the composer and **never submits**. The user asked for a
 * better prompt, not for it to be sent.
 */

interface Props {
  state: Extract<RefineState, { phase: 'reviewing' }> | RefineState;
  store: RefineStore;
}

export function RefineReview({ state, store }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);

  useFocusTrap(dialogRef, true);

  // Reset editing when a new suggestion arrives, or the panel would open in
  // edit mode after a second refinement.
  useEffect(() => setEditing(false), [state.suggestion]);

  if (state.phase !== 'reviewing') return null;

  const segments = diffWords(state.original, state.suggestion);
  const ratio = changeRatio(segments);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    store.dismiss();
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 flex items-center justify-center bg-black/40 p-4"
      data-testid="apa-refine-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="apa-refine-title"
        aria-describedby="apa-refine-summary"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="apa-refine-review"
        className="w-full max-w-2xl rounded-xl border p-5 shadow-2xl outline-none"
        style={{
          background: 'var(--apa-bg)',
          color: 'var(--apa-fg)',
          borderColor: 'var(--apa-border)',
          boxShadow: 'var(--apa-shadow)',
        }}
      >
        <h2 id="apa-refine-title" className="text-base font-semibold tracking-tight">
          Suggested rewrite
        </h2>

        <p
          id="apa-refine-summary"
          role="status"
          className="mt-1 text-sm"
          style={{ color: 'var(--apa-muted)' }}
          data-testid="apa-refine-summary"
        >
          {ratio > 0.6
            ? 'Substantially rewritten. Check it still says what you meant.'
            : 'Lightly edited. Nothing has been sent.'}
        </p>

        {editing ? (
          <textarea
            data-testid="apa-refine-edit"
            className="mt-4 h-48 w-full resize-y rounded-md border p-2 text-sm"
            style={{
              background: 'var(--apa-surface)',
              color: 'var(--apa-fg)',
              borderColor: 'var(--apa-border)',
            }}
            value={state.draft}
            onInput={(event) =>
              store.updateDraft((event.currentTarget as HTMLTextAreaElement).value)
            }
          />
        ) : (
          <div
            data-testid="apa-refine-diff"
            className="mt-4 max-h-64 overflow-auto rounded-md border p-3 text-sm whitespace-pre-wrap"
            style={{
              background: 'var(--apa-surface)',
              borderColor: 'var(--apa-border)',
            }}
          >
            {segments.map((segment, index) => {
              if (segment.op === 'same') return <span key={index}>{segment.text}</span>;

              const removed = segment.op === 'removed';
              return (
                <span
                  key={index}
                  data-diff={segment.op}
                  style={{
                    background: removed ? 'var(--apa-danger-bg)' : 'var(--apa-warn-bg)',
                    color: removed ? 'var(--apa-danger)' : 'var(--apa-warn)',
                    textDecoration: removed ? 'line-through' : 'none',
                    borderRadius: '2px',
                  }}
                >
                  {segment.text}
                </span>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="apa-refine-accept"
            onClick={() => store.accept()}
            className="rounded-md px-3 py-2 text-sm font-medium"
            style={{ background: 'var(--apa-accent)', color: 'var(--apa-accent-fg)' }}
          >
            Use this
          </button>

          {!editing && (
            <button
              type="button"
              data-testid="apa-refine-edit-toggle"
              onClick={() => setEditing(true)}
              className="rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--apa-border)', color: 'var(--apa-fg)' }}
            >
              Edit
            </button>
          )}

          <span className="grow" />

          <button
            type="button"
            data-testid="apa-refine-discard"
            onClick={() => store.dismiss()}
            className="rounded-md px-3 py-2 text-sm"
            style={{ color: 'var(--apa-muted)' }}
          >
            Keep mine
          </button>
        </div>

        <p className="mt-3 text-xs" style={{ color: 'var(--apa-muted)' }}>
          Improved on this device. Nothing was sent anywhere, and your prompt has not
          been submitted.
        </p>
      </div>
    </div>
  );
}
