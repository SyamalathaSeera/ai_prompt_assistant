import { useState } from 'preact/hooks';
import { ensureSession } from '@/lib/model';

/**
 * The one-time model download control.
 *
 * `run()` never starts the download itself — a few hundred megabytes is not
 * something a keystroke should begin on a metered connection — so every
 * surface that reports the "needs downloading" state has to offer a way out
 * of it, or that state is a dead end. Two surfaces now do: settings, and the
 * welcome page, which is where a new user first learns the feature is missing
 * and the worst possible place to leave them with only a link.
 *
 * Shared rather than copied. A download has a progress state and a failure
 * state, and two copies of either become two different ones the first time
 * one is edited — the same reason `PrivacyStatement` is a component instead
 * of duplicated copy.
 *
 * Colours come from `currentColor` rather than the `--apa-*` tokens, because
 * this renders on the options page, which loads plain Tailwind, as well as on
 * the welcome page, which loads the injected UI's stylesheet.
 */
interface Props {
  /**
   * Called once the attempt settles, either way.
   *
   * The host re-reads `getModelFeatures()` rather than being handed the
   * outcome: availability is the browser's answer, not one we should infer
   * from a resolved promise. On success that re-read is also what makes this
   * control disappear.
   */
  onSettled: () => void;
}

export function ModelDownload({ onSettled }: Props) {
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  /*
   * Called straight from the click, not after an await: Chrome requires user
   * activation to start a model download, and awaiting first loses it.
   */
  const start = () => {
    setFailed(false);
    setProgress(0);

    void ensureSession(({ loaded }) => setProgress(loaded)).then((session) => {
      setProgress(null);
      if (!session) setFailed(true);
      onSettled();
    });
  };

  return (
    <>
      <button
        type="button"
        data-testid="model-download"
        disabled={progress !== null}
        onClick={start}
        className="rounded-md border border-current/20 px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {progress === null
          ? 'Download the model'
          : `Downloading… ${Math.round(progress * 100)}%`}
      </button>

      {failed && (
        <p className="mt-2 text-xs" data-testid="model-download-failed">
          The download did not finish. Everything else still works — secrets are
          detected and redacted without it.
        </p>
      )}
    </>
  );
}
