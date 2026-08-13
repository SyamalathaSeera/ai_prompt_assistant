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
import { detect, redact } from '@/lib/detector/engine';
import { findPlaceholders, hydrate, needsHydration } from '@/lib/rehydrate';
import { putAll, resolve as resolveFromVault } from '@/lib/vault';
import { getSettingsSync, initSettings, recordCatch, setSettings } from '@/lib/storage';
import { addToAllowlist, filterAllowlisted } from '@/lib/policy/allowlist';
import type { Finding } from '@/lib/detector/types';
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

    const store = createPanelStore({
      /**
       * "Never flag this value" — permanent, across every conversation.
       *
       * Stores a SHA-256 hash, never the plaintext, so the allowlist cannot
       * itself become a place secrets accumulate.
       */
      onAllowlist: (value, label) => {
        void (async () => {
          try {
            // getSettingsSync directly, not the local alias declared further
            // down: correct either way, but it removes a dependency on
            // declaration order inside this closure.
            const allowlist = await addToAllowlist(
              value,
              getSettingsSync().allowlist,
              label,
            );
            await setSettings({ allowlist });
          } catch {
            /* a failed allowlist costs one more prompt, never the submission */
          }
        })();
      },
    });

    /** Conversation scope for vault entries. See ADR-005. */
    const conversationId = () => adapter.getConversationId?.() ?? 'unsaved';

    /**
     * Remembers what a redaction replaced, so the reply can be restored.
     *
     * Called at the moment of sending, since that is when we know both the
     * placeholder and the value it stood for.
     */
    const rememberRedaction = (original: string, replacement: string) => {
      try {
        if (!getSettings().rehydrateResponses) return;
        // Re-derive the mapping from the text actually being sent, rather than
        // trusting the UI's copy of it — the user may have edited by hand.
        const findings = detect(original, {}, undefined);
        const { map } = redact(original, findings);

        const used = Object.fromEntries(
          Object.entries(map).filter(([placeholder]) => replacement.includes(placeholder)),
        );
        void putAll(used, conversationId());
      } catch {
        /* failing to remember costs re-hydration, never the submission */
      }
    };

    const riskStore = createRiskStore({
      // Rewrites the composer without submitting, so the user can clean up a
      // draft on their own initiative rather than only when interrupted.
      onApplyRedaction: (text) => {
        const composer = adapter.getComposer();
        if (!composer) return;
        rememberRedaction(adapter.getText(composer), text);
        adapter.setText(composer, text);
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

    /**
     * Settings, read synchronously.
     *
     * The interception path cannot await storage — `detect()` is synchronous
     * by design (ADR-004), and an async submit handler would mean the prompt
     * is already gone by the time settings arrive. So settings are loaded into
     * a cache and refreshed on change.
     */
    const getSettings = getSettingsSync;
    const stopWatchingSettings = await initSettings();

    /**
     * Suppresses allowlisted values.
     *
     * Hashing is async and lives outside the detector (ADR-004), so it runs
     * over the findings AFTER detection rather than over every candidate
     * during it — findings are few, and the scan stays synchronous.
     */
    const applyAllowlist = async (text: string, findings: readonly Finding[]) =>
      filterAllowlisted(text, findings, getSettings().allowlist);

    const stopIntercepting = createInterceptor({
      adapter,
      getSettings,
      onHeld: (submission) => {
        void (async () => {
          const blocking = await applyAllowlist(submission.text, submission.blocking);

          // Everything blocking was allowlisted, so there is nothing to ask
          // about — release the submission rather than showing an empty modal.
          if (blocking.length === 0) {
            submission.sendOriginal();
            return;
          }

          for (const finding of blocking) void recordCatch(finding.ruleId);

          store.present({
            ...submission,
            blocking,
            findings: await applyAllowlist(submission.text, submission.findings),
            sendReplacement: (replacement) => {
              rememberRedaction(submission.text, replacement);
              submission.sendReplacement(replacement);
            },
          });
        })();
      },
    });

    /**
     * Restores redacted values in assistant replies.
     *
     * Runs on every observed change to an assistant turn. `needsHydration`
     * short-circuits the common case — most changes contain no placeholders —
     * and because hydrated spans are skipped, our own mutations produce no
     * further work. That is what keeps this from looping on the observer it
     * is driven by, without any suppression flag.
     */
    const stopObserving =
      adapter.observeResponse?.((turn) => {
        void (async () => {
          try {
            if (!getSettings().rehydrateResponses) return;
            if (!needsHydration(turn)) return;

            const scope = conversationId();
            const placeholders = findPlaceholders(turn);
            if (placeholders.length === 0) return;

            const resolved: Record<string, string> = {};
            for (const placeholder of placeholders) {
              const value = await resolveFromVault(placeholder, scope);
              if (value !== null) resolved[placeholder] = value;
            }
            if (Object.keys(resolved).length === 0) return;

            // Re-check: the reply may have streamed further while we awaited
            // the vault, and React may have replaced the nodes underneath us.
            if (!turn.isConnected) return;
            hydrate(turn, resolved);
          } catch {
            /* re-hydration failing leaves placeholders on screen — which is
               exactly what was sent, so the page stays truthful */
          }
        })();
      }) ?? (() => {});

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
      stopObserving();
      stopWatchingSettings();
      ui.remove();
    });
  },
});
