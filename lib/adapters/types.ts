/**
 * Site adapter types.
 *
 * ARCHITECTURE.md pattern 3: adapters are the ONLY modules permitted to know
 * what a host page's DOM looks like. Everything else in the extension talks to
 * this interface.
 *
 * Host pages ship DOM changes constantly. Confining that churn to one file per
 * platform is what makes a broken selector a small fix rather than a rewrite,
 * and what makes adding a platform an afternoon of work (milestone 0.1.0.0).
 */

/** How the user tried to submit. */
export type SubmitTrigger = 'enter' | 'button' | 'form';

export interface SubmitIntent {
  trigger: SubmitTrigger;
  /** The originating DOM event, so the handler can preventDefault/stopPropagation. */
  event: Event;
  /** Releases the held submission and lets the host page proceed normally. */
  release: () => void;
}

export interface PasteEvent {
  /** Plain text from the clipboard. */
  text: string;
  event: ClipboardEvent;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  element: HTMLElement;
}

/** Detaches a listener or observer. Every subscribe method returns one. */
export type Disposer = () => void;

/**
 * Diagnostic output from an adapter's self-check. Surfaced to the user in
 * milestone 0.2.0.1 so a silent failure becomes a visible
 * "protection unavailable" state — a security tool that quietly stops working
 * is worse than one that is obviously off.
 */
export interface AdapterHealth {
  composerFound: boolean;
  submitListenersAttached: boolean;
  /** Which selector in the fallback chain resolved, for debugging DOM churn. */
  resolvedVia: string | null;
}

export interface SiteAdapter {
  /** Stable id, e.g. `chatgpt`. */
  id: string;
  /** Match patterns this adapter handles. Must stay in sync with the content script. */
  hostPatterns: readonly string[];

  /**
   * Resolves the composer element. Returns null when absent — a normal
   * condition during page load or SPA navigation, never an error.
   */
  getComposer(): HTMLElement | null;

  getText(el: HTMLElement): string;

  /**
   * Writes text into the composer. Rich editors need specific events
   * dispatched or their framework state will not update, so implementations
   * must verify the value survives a re-render.
   */
  setText(el: HTMLElement, text: string): void;

  /** Subscribes to submit attempts (Enter, button click, form submit). */
  onSubmitIntent(cb: (intent: SubmitIntent) => void): Disposer;

  /**
   * Subscribes to pastes into the composer.
   *
   * Optional: a platform where the composer cannot be identified reliably
   * should omit this rather than fire on every paste in the page.
   */
  onPaste?(cb: (paste: PasteEvent) => void): Disposer;

  /**
   * Subscribes to edits in the composer.
   *
   * Fires on every keystroke, so consumers must debounce. Used to drive the
   * always-on risk indicator.
   */
  onInput?(cb: () => void): Disposer;

  /** Prior conversation turns. Optional — not every platform can support it. */
  getMessages?(): ChatMessage[];

  /**
   * Observes assistant responses as they stream in. Used for re-hydration
   * (milestone 0.0.5.0). Optional: if a platform makes this impractical,
   * declare it unsupported rather than shipping something flaky.
   */
  observeResponse?(cb: (node: HTMLElement) => void): Disposer;

  /** Reports what currently resolves, for health checks and diagnostics. */
  checkHealth(): AdapterHealth;
}
