import { useState } from 'preact/hooks';
import type { ClarifyState, ClarifyStore } from './clarify-store';

/**
 * The clarification question.
 *
 * **A question, not a replacement.** The original concept was explicit about
 * this and it is the right call: an automatic rewrite of what someone meant is
 * a much worse failure than a redaction error, because it is invisible. The
 * prompt still reads like something they might have written, so there is no
 * moment where they notice it went wrong.
 *
 * Deliberately **not a modal**, unlike the approval modal and the refinement
 * review. Those two interrupt because something is at stake — a secret is
 * about to leave, or the user explicitly asked for a rewrite and is waiting.
 * This one is unsolicited, so it sits beside the composer, traps no focus,
 * blocks no key, and blocks no send. Someone who ignores it entirely should
 * notice no cost at all.
 */

interface Props {
  state: ClarifyState;
  store: ClarifyStore;
}

export function ClarifyQuestion({ state, store }: Props) {
  const [editing, setEditing] = useState(false);

  if (state.phase !== 'asking') return null;

  return (
    <section
      // `region`, not `dialog`: nothing here is modal, and announcing it as a
      // dialog would tell a screen-reader user they must deal with it first.
      role="region"
      aria-label="Suggested interpretation"
      data-testid="apa-clarify"
      className="pointer-events-auto w-full max-w-lg rounded-xl border p-4 shadow-lg"
      style={{
        background: 'var(--apa-bg)',
        color: 'var(--apa-fg)',
        borderColor: 'var(--apa-border)',
        boxShadow: 'var(--apa-shadow)',
      }}
    >
      <h2 className="text-sm font-semibold tracking-tight">Do you mean:</h2>

      {editing ? (
        <textarea
          data-testid="apa-clarify-edit"
          aria-label="Edit the interpretation"
          className="mt-2 h-28 w-full resize-y rounded-md border p-2 text-sm"
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
        <p
          data-testid="apa-clarify-suggestion"
          className="mt-2 rounded-md border p-3 text-sm whitespace-pre-wrap"
          style={{ background: 'var(--apa-surface)', borderColor: 'var(--apa-border)' }}
        >
          {state.suggestion}
        </p>
      )}

      {state.sources.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-medium" style={{ color: 'var(--apa-muted)' }}>
            Based on
          </h3>

          {/*
            * Provenance is the point, not decoration.
            *
            * Showing WHAT it resolved to without showing WHERE THAT CAME FROM
            * makes a wrong guess look plausible — which is the failure mode
            * this whole feature exists to prevent. Tied to the turn, a wrong
            * guess is obvious at a glance.
            */}
          <ul data-testid="apa-clarify-sources" className="mt-1 space-y-1">
            {state.sources.map((source) => (
              <li
                key={`${source.turnIndex}:${source.text}`}
                data-testid="apa-clarify-source"
                data-turn-index={source.turnIndex}
                className="text-xs"
                style={{ color: 'var(--apa-muted)' }}
              >
                <span className="font-medium" style={{ color: 'var(--apa-fg)' }}>
                  {source.text}
                </span>
                {' — from '}
                {source.role === 'user' ? 'your message' : 'the reply'}
                {': '}
                <q>{source.excerpt}</q>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="apa-clarify-accept"
          onClick={() => store.accept()}
          className="rounded-md px-3 py-2 text-sm font-medium"
          style={{ background: 'var(--apa-accent)', color: 'var(--apa-accent-fg)' }}
        >
          Yes, use this
        </button>

        {!editing && (
          <button
            type="button"
            data-testid="apa-clarify-edit-toggle"
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
          data-testid="apa-clarify-decline"
          onClick={() => store.decline()}
          className="rounded-md px-3 py-2 text-sm"
          style={{ color: 'var(--apa-muted)' }}
        >
          No, send mine
        </button>
      </div>

      <p className="mt-3 text-xs" style={{ color: 'var(--apa-muted)' }}>
        Read on this device. Your prompt has not been changed or sent.
      </p>
    </section>
  );
}
