import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAvailability, getCapability, isModelPossible } from './capability';
import { __resetForTests, destroySession, ensureSession, hasSession, run } from './session';

/**
 * Model layer tests.
 *
 * The most important property here is not that the model works — it is that
 * **everything keeps working when there is no model.** Redaction is what people
 * install this for; refinement is an addition. A machine that cannot run the
 * model must lose exactly the model-backed features and nothing else.
 */

interface FakeOptions {
  availability?: string;
  promptImpl?: (input: string, options?: { signal?: AbortSignal }) => Promise<string>;
  createThrows?: boolean;
  contextWindow?: number;
  measure?: (input: string) => Promise<number>;
}

function installFakeModel(options: FakeOptions = {}) {
  const destroy = vi.fn();
  const create = vi.fn(async (createOptions?: { monitor?: (m: EventTarget) => void }) => {
    if (options.createThrows) throw new Error('download declined');

    // Exercise the download-progress wiring the same way Chrome does.
    if (createOptions?.monitor) {
      const monitor = new EventTarget();
      createOptions.monitor(monitor);
      const event = new Event('downloadprogress') as Event & { loaded?: number };
      event.loaded = 0.5;
      monitor.dispatchEvent(event);
    }

    return {
      prompt:
        options.promptImpl ??
        (async () => 'a refined prompt'),
      destroy,
      contextWindow: options.contextWindow,
      measureContextUsage: options.measure,
    };
  });

  vi.stubGlobal('LanguageModel', {
    availability: async () => options.availability ?? 'available',
    create,
  });

  return { create, destroy };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  __resetForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetForTests();
});

describe('capability detection', () => {
  it('reports unavailable when the API is absent', async () => {
    // The expected path on Firefox and on older Chrome — not an error.
    expect(await getAvailability()).toBe('unavailable');
    expect(await isModelPossible()).toBe(false);
  });

  it('reports unavailable rather than throwing when the probe throws', async () => {
    vi.stubGlobal('LanguageModel', {
      availability: () => Promise.reject(new Error('blocked')),
      create: () => Promise.resolve({}),
    });

    expect(await getAvailability()).toBe('unavailable');
  });

  it.each([
    ['available', 'available'],
    ['readily', 'available'],
    ['downloadable', 'downloadable'],
    ['after-download', 'downloadable'],
    ['downloading', 'downloading'],
    ['nonsense', 'unavailable'],
  ])('maps %s to %s', async (raw, expected) => {
    installFakeModel({ availability: raw });
    expect(await getAvailability()).toBe(expected);
  });

  it('reads the older self.ai.languageModel surface', async () => {
    // The API has shipped under more than one name and users span versions.
    vi.stubGlobal('ai', {
      languageModel: {
        capabilities: async () => ({ available: 'readily' }),
        create: async () => ({ prompt: async () => 'x', destroy: () => {} }),
      },
    });

    expect(await getAvailability()).toBe('available');
  });

  it('separates "ready now" from "possible here"', async () => {
    // A control saying "download the model to use this" is useful. A control
    // that is present but permanently broken is not.
    installFakeModel({ availability: 'downloadable' });
    const capability = await getCapability();

    expect(capability.ready).toBe(false);
    expect(capability.possible).toBe(true);
  });
});

describe('session lifecycle', () => {
  it('reuses one session across calls', async () => {
    const { create } = installFakeModel();

    await run('first');
    await run('second');

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('shares a single creation between concurrent callers', async () => {
    // Two callers must not race into downloading the model twice.
    const { create } = installFakeModel();

    await Promise.all([ensureSession(), ensureSession(), ensureSession()]);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('reports download progress so the UI can show the cost', async () => {
    installFakeModel();
    const progress: number[] = [];

    await ensureSession((p) => progress.push(p.loaded));

    expect(progress).toContain(0.5);
  });

  it('destroys the session on teardown', async () => {
    const { destroy } = installFakeModel();
    await ensureSession();
    expect(hasSession()).toBe(true);

    destroySession();

    expect(destroy).toHaveBeenCalled();
    expect(hasSession()).toBe(false);
  });

  it('returns null rather than throwing when creation fails', async () => {
    installFakeModel({ createThrows: true });
    expect(await ensureSession()).toBeNull();
  });
});

describe('running a prompt', () => {
  it('returns the model output', async () => {
    installFakeModel();
    const result = await run('improve this');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('a refined prompt');
  });

  it('trims whitespace from the response', async () => {
    installFakeModel({ promptImpl: async () => '  padded  ' });
    const result = await run('x');

    expect(result.ok && result.text).toBe('padded');
  });

  it('treats an empty response as a failure', async () => {
    installFakeModel({ promptImpl: async () => '   ' });
    const result = await run('x');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('failed');
  });

  it('never starts a download as a side effect of prompting', async () => {
    // Pulling hundreds of megabytes because someone typed would be a hostile
    // surprise on a metered connection.
    const { create } = installFakeModel({ availability: 'downloadable' });
    const result = await run('x');

    expect(create).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-downloaded');
  });

  it('reports unavailable with no API present', async () => {
    const result = await run('x');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unavailable');
  });
});

describe('guardrails', () => {
  it('times out rather than hanging', async () => {
    installFakeModel({
      promptImpl: (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    const result = await run('x', { timeoutMs: 20 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('timeout');
  });

  it('reports an abort separately from a timeout', async () => {
    // The user changing their mind and our deadline expiring are different
    // events, and the UI says different things about each.
    installFakeModel({
      promptImpl: (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    const controller = new AbortController();
    const pending = run('x', { signal: controller.signal, timeoutMs: 5000 });
    controller.abort();

    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('aborted');
  });

  it('returns immediately when already aborted', async () => {
    const { create } = installFakeModel();
    const controller = new AbortController();
    controller.abort();

    const result = await run('x', { signal: controller.signal });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('aborted');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses oversized input rather than truncating it', async () => {
    // A silently truncated prompt produces a confidently wrong rewrite, and
    // the user has no way to tell that half their text was dropped.
    installFakeModel({
      contextWindow: 100,
      measure: async () => 500,
    });

    const result = await run('a very long prompt');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-long');
  });

  it('proceeds when the model cannot measure context', async () => {
    installFakeModel({ contextWindow: undefined, measure: undefined });
    expect((await run('x')).ok).toBe(true);
  });

  it('never throws, whatever the model does', async () => {
    installFakeModel({
      promptImpl: async () => {
        throw new Error('model exploded');
      },
    });

    const result = await run('x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('failed');
  });
});

describe('degradation', () => {
  it('every failure is a value, never an exception', async () => {
    // Callers are forced to handle failure. An exception would let one forget,
    // and the broken UI would appear on exactly the machines least able to run
    // the feature.
    const scenarios = [
      () => undefined,
      () => installFakeModel({ availability: 'downloadable' }),
      () => installFakeModel({ createThrows: true }),
      () =>
        installFakeModel({
          promptImpl: async () => {
            throw new Error('boom');
          },
        }),
    ];

    for (const setUp of scenarios) {
      vi.unstubAllGlobals();
      __resetForTests();
      setUp();

      await expect(run('x')).resolves.toMatchObject({ ok: false });
    }
  });
});
