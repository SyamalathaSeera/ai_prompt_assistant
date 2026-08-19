import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { ModelDownload } from './ModelDownload';
import { __resetForTests as resetSession } from '@/lib/model/session';

/**
 * The control that gets a user out of the "needs downloading" state.
 *
 * It is the only thing in the product that starts the download, and it now
 * renders on two pages, so its behaviour is tested here once rather than
 * twice at each call site.
 */

let container: HTMLElement;

const $ = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const waitFor = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3000 });

/** Stands in for Chrome's Prompt API, with the caller's `create`. */
function installModel(create: (options: { monitor: (m: EventTarget) => void }) => Promise<unknown>) {
  vi.stubGlobal('LanguageModel', {
    availability: async () => 'downloadable',
    create,
  });
}

const A_SESSION = { prompt: async () => '', destroy: () => {} };

beforeEach(() => {
  vi.unstubAllGlobals();
  resetSession();
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  vi.unstubAllGlobals();
  resetSession();
});

describe('the model download control', () => {
  it('starts the download when clicked', async () => {
    const create = vi.fn(async () => A_SESSION);
    installModel(create);
    render(<ModelDownload onSettled={() => {}} />, container);

    $('model-download')!.click();

    await waitFor(() => expect(create).toHaveBeenCalled());
  });

  it('shows how far along the download is', async () => {
    /*
     * The whole reason `ensureSession` takes a progress callback. A button
     * that sat unchanged for several minutes while hundreds of megabytes
     * arrived would read as a control that did nothing.
     */
    let finish: (session: unknown) => void = () => {};
    installModel((options) => {
      const monitor = new EventTarget();
      options.monitor(monitor);
      const event = new Event('downloadprogress') as Event & { loaded?: number };
      event.loaded = 0.42;
      monitor.dispatchEvent(event);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    render(<ModelDownload onSettled={() => {}} />, container);

    $('model-download')!.click();

    await waitFor(() => expect($('model-download')!.textContent).toContain('42%'));
    finish(A_SESSION);
  });

  it('cannot be started twice while it is running', async () => {
    // A second create() would be a second download of the same model.
    let finish: (session: unknown) => void = () => {};
    const create = vi.fn(() => new Promise<unknown>((resolve) => (finish = resolve)));
    installModel(create);
    render(<ModelDownload onSettled={() => {}} />, container);

    $('model-download')!.click();

    await waitFor(() =>
      expect(($('model-download') as HTMLButtonElement).disabled).toBe(true),
    );
    $('model-download')!.click();

    expect(create).toHaveBeenCalledTimes(1);
    finish(A_SESSION);
  });

  it('reports a failed download without alarming the user', async () => {
    /*
     * Declined, out of disk, or hardware that gave up. None of it touches
     * redaction, and a user who concludes otherwise uninstalls something that
     * is still protecting them.
     */
    installModel(() => Promise.reject(new Error('declined')));
    render(<ModelDownload onSettled={() => {}} />, container);

    $('model-download')!.click();

    await waitFor(() => expect($('model-download-failed')).not.toBeNull());
    expect($('model-download-failed')!.textContent).toContain('still works');
  });

  it('offers the button again after a failure', async () => {
    // A dead end reached by a different route is still a dead end.
    installModel(() => Promise.reject(new Error('declined')));
    render(<ModelDownload onSettled={() => {}} />, container);

    $('model-download')!.click();

    await waitFor(() => expect($('model-download-failed')).not.toBeNull());
    expect(($('model-download') as HTMLButtonElement).disabled).toBe(false);
    expect($('model-download')!.textContent).toContain('Download');
  });

  it('tells the host to re-read availability once it settles', async () => {
    /*
     * The component never claims the model is ready. It says the attempt is
     * over, and the host asks the browser — which is what makes the control
     * disappear on success and stay on failure.
     */
    const onSettled = vi.fn();
    installModel(async () => A_SESSION);
    render(<ModelDownload onSettled={onSettled} />, container);

    $('model-download')!.click();

    await waitFor(() => expect(onSettled).toHaveBeenCalled());
  });

  it('tells the host to re-read even when the download failed', async () => {
    const onSettled = vi.fn();
    installModel(() => Promise.reject(new Error('declined')));
    render(<ModelDownload onSettled={onSettled} />, container);

    $('model-download')!.click();

    await waitFor(() => expect(onSettled).toHaveBeenCalled());
  });
});
