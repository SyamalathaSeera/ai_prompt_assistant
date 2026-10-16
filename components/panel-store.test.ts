import { describe, expect, it, vi } from 'vitest';
import { createPanelStore } from './panel-store';
import { detect } from '@/lib/detector/engine';
import { ALL_RULES } from '@/lib/detector/rules';
import type { HeldSubmission } from '@/lib/interception/controller';

const TEXT = 'AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7';

function makeSubmission(text = TEXT): HeldSubmission & {
  sentOriginal: () => number;
  sentReplacement: () => string[];
  cancelled: () => number;
} {
  const findings = detect(text, {}, ALL_RULES);
  let originals = 0;
  let cancels = 0;
  const replacements: string[] = [];

  return {
    text,
    findings,
    blocking: findings.filter((f) => f.tier === 'high'),
    held: true,
    sendOriginal: () => {
      originals += 1;
    },
    sendReplacement: (r: string) => {
      replacements.push(r);
    },
    cancel: () => {
      cancels += 1;
    },
    sentOriginal: () => originals,
    sentReplacement: () => replacements,
    cancelled: () => cancels,
  };
}

describe('presenting a submission', () => {
  it('starts idle', () => {
    expect(createPanelStore().get()).toEqual({ kind: 'idle' });
  });

  it('computes the redacted text up front', () => {
    const store = createPanelStore();
    store.present(makeSubmission());

    const state = store.get();
    expect(state.kind).toBe('active');
    if (state.kind !== 'active') return;

    expect(state.redactedText).toContain('[REDACTED_');
    expect(state.redactedText).not.toContain('AKIA3TZ2MRSYNTHETIC7');
    expect(state.phase).toBe('reviewing');
  });

  it('notifies subscribers', () => {
    const store = createPanelStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.present(makeSubmission());

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].kind).toBe('active');
  });

  it('stops notifying after unsubscribe', () => {
    const store = createPanelStore();
    const listener = vi.fn();
    store.subscribe(listener)();

    store.present(makeSubmission());

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('sending', () => {
  it('sends the redacted text', () => {
    const store = createPanelStore();
    const submission = makeSubmission();
    store.present(submission);

    store.sendRedacted();

    expect(submission.sentReplacement()).toHaveLength(1);
    expect(submission.sentReplacement()[0]).toContain('[REDACTED_');
    expect(store.get()).toEqual({ kind: 'idle' });
  });

  it('sends the original unchanged', () => {
    const store = createPanelStore();
    const submission = makeSubmission();
    store.present(submission);

    store.sendOriginal();

    expect(submission.sentOriginal()).toBe(1);
    expect(submission.sentReplacement()).toEqual([]);
    expect(store.get()).toEqual({ kind: 'idle' });
  });

  it('sends the user’s edit rather than the suggestion', () => {
    const store = createPanelStore();
    const submission = makeSubmission();
    store.present(submission);

    store.startEditing();
    store.updateDraft('my own wording, no secret');
    store.sendEdited();

    expect(submission.sentReplacement()).toEqual(['my own wording, no secret']);
  });

  it('ignores a second send, so a double click cannot send twice', () => {
    const store = createPanelStore();
    const submission = makeSubmission();
    store.present(submission);

    store.sendRedacted();
    store.sendRedacted();
    store.sendOriginal();

    expect(submission.sentReplacement()).toHaveLength(1);
    expect(submission.sentOriginal()).toBe(0);
  });

  it('ignores actions when there is nothing active', () => {
    const store = createPanelStore();
    expect(() => {
      store.sendRedacted();
      store.sendOriginal();
      store.sendEdited();
      store.startEditing();
      store.updateDraft('x');
      store.dismiss();
    }).not.toThrow();
    expect(store.get()).toEqual({ kind: 'idle' });
  });
});

describe('editing', () => {
  it('seeds the draft with the redacted text', () => {
    const store = createPanelStore();
    store.present(makeSubmission());
    store.startEditing();

    const state = store.get();
    if (state.kind !== 'active') throw new Error('expected active');
    expect(state.draft).toBe(state.redactedText);
    expect(state.phase).toBe('editing');
  });

  it('ignores draft updates outside editing', () => {
    const store = createPanelStore();
    store.present(makeSubmission());

    store.updateDraft('should be ignored');

    const state = store.get();
    if (state.kind !== 'active') throw new Error('expected active');
    expect(state.draft).toBe(state.redactedText);
  });
});

describe('dismissal', () => {
  it('does not send', () => {
    // Escape and Cancel are dismissal gestures. A security tool that
    // transmits secrets when waved away has the default backwards.
    const store = createPanelStore();
    const submission = makeSubmission();
    store.present(submission);

    store.dismiss();

    expect(submission.sentOriginal()).toBe(0);
    expect(submission.sentReplacement()).toEqual([]);
    expect(submission.cancelled()).toBe(1);
    expect(store.get()).toEqual({ kind: 'idle' });
  });
});

describe('no state strands a submission', () => {
  // The guarantee this store exists to provide: a held prompt is always
  // either sent or handed back to the user. It can never become unreachable.

  it('every terminal action returns to idle', () => {
    for (const act of ['sendRedacted', 'sendOriginal', 'sendEdited', 'dismiss'] as const) {
      const store = createPanelStore();
      store.present(makeSubmission());
      store[act]();
      expect(store.get(), `${act} left the store non-idle`).toEqual({ kind: 'idle' });
    }
  });

  it('returns to idle even when the send action throws', () => {
    const store = createPanelStore();
    const submission = makeSubmission();
    submission.sendReplacement = () => {
      throw new Error('adapter exploded');
    };
    store.present(submission);

    expect(() => store.sendRedacted()).toThrow();
    // The modal must not be left open over a prompt the controller has already
    // released by its own fail-open path.
    expect(store.get()).toEqual({ kind: 'idle' });
  });

  it('cannot be dismissed mid-send', () => {
    const store = createPanelStore();
    const submission = makeSubmission();
    let cancelledDuringSend = 0;

    submission.sendReplacement = () => {
      store.dismiss();
      cancelledDuringSend = submission.cancelled();
    };
    store.present(submission);
    store.sendRedacted();

    expect(cancelledDuringSend).toBe(0);
  });
});


describe('acknowledged redaction persistence', () => {
  it('keeps the modal busy and prevents double send until persistence succeeds', async () => {
    const store = createPanelStore();
    const submission = makeSubmission();
    let complete!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    submission.sendReplacement = send;
    store.present(submission);
    store.sendRedacted();
    store.sendRedacted();
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.get().kind === 'active' && store.get()).toMatchObject({ phase: 'applying' });
    complete();
    await Promise.resolve();
    expect(store.get()).toEqual({ kind: 'idle' });
  });

  it('keeps the reviewed draft available and shows a static message after failure', async () => {
    const store = createPanelStore();
    const submission = makeSubmission();
    submission.sendReplacement = async () => { throw new Error('synthetic storage failure'); };
    store.present(submission);
    store.sendRedacted();
    await Promise.resolve();
    expect(store.get()).toMatchObject({ kind: 'active', phase: 'reviewing', error: expect.stringContaining('Nothing was sent') });
    expect(submission.sentOriginal()).toBe(0);
    expect(submission.sentReplacement()).toHaveLength(0);
    store.dismiss();
    expect(store.get()).toEqual({ kind: 'idle' });
  });
});
