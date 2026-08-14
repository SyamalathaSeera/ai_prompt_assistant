import { Component } from 'preact';
import type { ComponentChildren } from 'preact';

/**
 * Catches a crash in the injected UI.
 *
 * This exists because of a specific, reachable failure that the interception
 * controller's own fail-open path cannot cover. The controller wraps
 * `onHeld()` in a try/catch — but `onHeld` only *sets state*. Preact renders
 * afterwards, on its own schedule, outside that try block. So a component that
 * throws while rendering the approval modal throws into nothing, and the
 * submission stays cancelled with no UI to resolve it: a prompt the user can
 * neither send nor get back.
 *
 * **What it does about it is the interesting part.** The obvious move —
 * release the submission — is wrong. Releasing sends the user's original text,
 * secrets and all, at the exact moment we have lost the ability to warn them.
 * A crash must not become a silent transmission.
 *
 * So it dismisses instead. The submission was cancelled before it left, which
 * means the text is still sitting in the composer: nothing is lost, nothing is
 * sent, and the user's next Enter is theirs to decide on. That is the only exit
 * that is both fail-open and honest.
 */

interface Props {
  children?: ComponentChildren;
  /**
   * Called once, on the first crash.
   *
   * The caller is responsible for resolving any held submission and for telling
   * the user protection has stopped — see the content script.
   */
  onError: (error: unknown) => void;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  override componentDidCatch(error: unknown) {
    // Set first, notify second. If the handler throws, the subtree is already
    // torn down and cannot crash again on the next render.
    this.setState({ failed: true });

    try {
      this.props.onError(error);
    } catch {
      /* a failing error handler must not re-enter the boundary */
    }
  }

  override render() {
    /*
     * Renders nothing once it has failed, and never retries.
     *
     * A boundary that re-mounts the broken subtree on the next state change
     * would crash again, and again — turning one bug into a loop that holds
     * every subsequent submission. Staying down is what makes the caller's
     * "protection unavailable" state true rather than aspirational.
     */
    if (this.state.failed) return null;
    return this.props.children;
  }
}
