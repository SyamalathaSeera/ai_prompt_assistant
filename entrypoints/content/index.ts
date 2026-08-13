import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { h, render } from 'preact';
import { detectTheme, observeTheme } from '@/components/theme';
import { createPanelStore } from '@/components/panel-store';
import { createRiskStore } from '@/components/risk-store';
import { Panel } from '@/components/Panel';
import { resolveAdapter } from '@/lib/adapters/registry';
import { createInterceptor } from '@/lib/interception/controller';
import { createLiveScanner } from '@/lib/interception/live-scan';
import { createPasteWatcher } from '@/lib/interception/paste';
import { DEFAULT_SETTINGS } from '@/lib/policy/defaults';
import './style.css';

/**
 * Content script entrypoint.
 *
 * Deliberately thin. It wires the pieces together and owns nothing testable:
 * DOM knowledge lives in the adapter, detection in the detector, decisions in
 * the interception controller, and UI state in the panel store. What is here
 * is the shadow-root mount, which depends on WXT's content-script context and
 * cannot be unit tested meaningfully.
 */
export default defineContentScript({
  // Must stay identical to CHATGPT_MATCHES in lib/adapters/chatgpt.ts.
  // WXT extracts these at build time, so they are written as literals rather
  // than imported. test/adapter-matches.test.ts asserts the two stay in sync —
  // drift would mean the extension either fails to inject or tries to inject
  // where it holds no host permission.
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],

  // Routes the imported CSS into the shadow root instead of the page head, so
  // our styles cannot leak into ChatGPT's layout.
  cssInjectionMode: 'ui',

  async main(ctx) {
    const adapter = resolveAdapter(location.hostname);
    // Unsupported host: exit quietly. Not an error, and not worth logging.
    if (!adapter) return;

    console.log(`[APA] content script active v${__APP_VERSION__}`);

    const store = createPanelStore();

    const riskStore = createRiskStore({
      // Rewrites the composer without submitting, so the user can clean up a
      // draft on their own initiative rather than only when interrupted.
      onApplyRedaction: (text) => {
        const composer = adapter.getComposer();
        if (composer) adapter.setText(composer, text);
      },
    });

    let mountedIn: HTMLElement | undefined;
    let stopThemeWatch: (() => void) | undefined;

    const ui = await createShadowRootUi(ctx, {
      name: 'ai-prompt-assistant',
      position: 'overlay',
      anchor: 'body',
      // Keyboard events must not escape our panel. Without this, Enter pressed
      // while editing a redaction inside the modal would reach ChatGPT's own
      // handler and submit the very prompt we are holding.
      isolateEvents: true,

      onMount: (container) => {
        // The shadow host is a normal page element, so its stacking context is
        // set here rather than in the stylesheet. It must clear ChatGPT's own
        // modals and dropdowns, and must not intercept clicks when idle.
        const host = ui.shadowHost;
        host.style.position = 'fixed';
        host.style.inset = '0';
        host.style.zIndex = '2147483647';
        host.style.pointerEvents = 'none';

        container.setAttribute('data-theme', detectTheme());
        stopThemeWatch = observeTheme((theme) => {
          container.setAttribute('data-theme', theme);
        });

        render(
          h(Panel, {
            store,
            riskStore,
            getComposer: () => adapter.getComposer(),
          }),
          container,
        );
        mountedIn = container;
        return container;
      },

      onRemove: () => {
        stopThemeWatch?.();
        stopThemeWatch = undefined;
        // Preact unmounts by rendering null into the same container.
        if (mountedIn) render(null, mountedIn);
        mountedIn = undefined;
      },
    });

    ui.mount();

    // Settings still come from defaults — storage lands in milestone 0.0.6.0.
    // Read through a getter so wiring real storage later changes one line.
    const getSettings = () => DEFAULT_SETTINGS;

    const stopIntercepting = createInterceptor({
      adapter,
      getSettings,
      onHeld: (submission) => store.present(submission),
    });

    const stopLiveScan = createLiveScanner({
      adapter,
      getSettings,
      onRiskChange: (risk) => {
        const composer = adapter.getComposer();
        const text = composer ? adapter.getText(composer) : '';
        riskStore.setRisk(risk.level, risk.findings, text);
      },
    });

    const stopPasteWatch = createPasteWatcher({
      adapter,
      getSettings,
      // Paste is advisory: open the badge's popover rather than interrupting.
      // Nothing has left the machine yet, and submit-time interception is the
      // actual gate.
      onRisk: () => riskStore.open(),
    });

    ctx.onInvalidated(() => {
      stopIntercepting();
      stopLiveScan();
      stopPasteWatch();
      ui.remove();
    });
  },
});
