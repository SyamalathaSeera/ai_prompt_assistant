import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { h, render } from 'preact';
import { detectTheme, observeTheme } from '@/components/theme';
import { createPanelStore } from '@/components/panel-store';
import { createRiskStore } from '@/components/risk-store';
import { createRefineStore } from '@/components/refine-store';
import { createClarifyStore } from '@/components/clarify-store';
import { getModelFeatures } from '@/lib/model';
import { Panel } from '@/components/Panel';
import { resolveAdapter } from '@/lib/adapters/registry';
import { createInterceptor } from '@/lib/interception/controller';
import { createLiveScanner } from '@/lib/interception/live-scan';
import { createPasteWatcher } from '@/lib/interception/paste';
import { detect, redact } from '@/lib/detector/engine';
import { findPlaceholders, hydrate, needsHydration } from '@/lib/rehydrate';
import { putAll, resolve as resolveFromVault } from '@/lib/vault';
import { getSettingsSync, initSettings, recordCatch, setSettings } from '@/lib/storage';
import { isRefineMessage } from '@/lib/messaging';
import { browser } from 'wxt/browser';
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

    /**
     * Whether to offer refinement at all.
     *
     * Derived from hardware, not settings. Read once at startup: a machine
     * either has the capability or it does not, and re-probing on every render
     * would be waste. If a model finishes downloading mid-session the button
     * appears on the next page load, which is an acceptable delay for a
     * once-ever event.
     */
    const refineAvailable = (await getModelFeatures()).showModelFeatures;

    /**
     * Settings, read synchronously.
     *
     * The interception path cannot await storage — `detect()` is synchronous
     * by design (ADR-004), and an async submit handler would mean the prompt
     * is already gone by the time settings arrive. So settings are loaded into
     * a cache and refreshed on change.
     *
     * Loaded here, before anything reads them: the refine store seeds its
     * remembered style at construction, and a cache that had not filled yet
     * would hand it the default and make the preference look unsaved.
     */
    const getSettings = getSettingsSync;
    const stopWatchingSettings = await initSettings();

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

    /**
     * Prompt refinement.
     *
     * `applyToComposer` writes text and does NOT submit — the user asked for a
     * better prompt, not for it to be sent. Detection settings are shared with
     * sending, so refinement redacts exactly what a submission would.
     */
    const refineStore = createRefineStore({
      getDraft: () => {
        const composer = adapter.getComposer();
        return composer ? adapter.getText(composer) : '';
      },
      applyToComposer: (text) => {
        const composer = adapter.getComposer();
        if (composer) adapter.setText(composer, text);
      },
      getDisabledRuleIds: () => getSettings().disabledRuleIds,
      // The style choice is a habit, not a per-prompt decision.
      initialStyle: getSettingsSync().refineStyle,
      onStyleChange: (refineStyle) => {
        void setSettings({ refineStyle }).catch(() => {
          /* an unremembered preference is not worth reporting */
        });
      },
    });

    /**
     * Clarify with context.
     *
     * Constructed unconditionally but only ever *driven* when the setting is
     * on — see the input watcher below. Building it costs nothing; it holds no
     * timers and does no work until `consider()` is called.
     */
    const clarifyStore = createClarifyStore({
      getDraft: () => {
        const composer = adapter.getComposer();
        return composer ? adapter.getText(composer) : '';
      },
      // Writes text and does NOT submit, exactly like refinement. Confirming
      // an interpretation is not the same as saying you are finished.
      applyToComposer: (text) => {
        const composer = adapter.getComposer();
        if (composer) adapter.setText(composer, text);
      },
      // Optional on the adapter: Gemini declines to read messages rather than
      // guess at unverified DOM, so there it simply never has context and the
      // feature stays silent.
      getTurns: () => adapter.getMessages?.() ?? [],
      getConversationId: () => adapter.getConversationId?.() ?? null,
      getDisabledRuleIds: () => getSettings().disabledRuleIds,
    });

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
            refineStore,
            clarifyStore,
            getComposer: () => adapter.getComposer(),
            refineAvailable,
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

    /**
     * The keyboard shortcut.
     *
     * Declared as a browser command and forwarded by the background worker, so
     * the user can rebind it at chrome://extensions/shortcuts and Chrome
     * refuses bindings that collide with its own. Still an explicit
     * invocation — the same action as pressing the button.
     */
    const onCommandMessage = (message: unknown) => {
      if (!isRefineMessage(message)) return;
      void refineStore.start();
    };
    browser.runtime.onMessage.addListener(onCommandMessage);

    /**
     * What drives clarification.
     *
     * **Deliberately hung off input, not off submit.** Nothing in this feature
     * may sit on the path a prompt takes to leave the page: the interception
     * controller already holds submissions for a reason that justifies the
     * cost, and an unsolicited suggestion is not that reason. Someone who never
     * looks at this feature must not wait a millisecond longer to send.
     *
     * The consequence is that the question can only ever arrive *before* a
     * send, never during one — and if it has not arrived by the time they press
     * Enter, the prompt goes as written.
     */
    const CLARIFY_IDLE_MS = 1200;
    let clarifyTimer: ReturnType<typeof setTimeout> | undefined;

    const stopClarifyWatch =
      adapter.onInput?.(() => {
        // Read fresh every time: the user can turn this on or off mid-session
        // and must not have to reload the page for it to take effect.
        if (!getSettings().clarifyEnabled) return;
        if (!refineAvailable) return;

        // Waits for a pause in typing. Someone mid-sentence has not finished
        // saying what they mean, and interpreting a half-written draft would
        // be both wasteful and wrong.
        clearTimeout(clarifyTimer);
        clarifyTimer = setTimeout(() => {
          // Fire-and-forget on purpose. Nothing awaits this, so nothing can be
          // delayed by it.
          void clarifyStore.consider();
        }, CLARIFY_IDLE_MS);
      }) ?? (() => {});

    const stopPasteWatch = createPasteWatcher({
      adapter,
      getSettings,
      // Paste is advisory: open the badge's popover rather than interrupting.
      // Nothing has left the machine yet, and submit-time interception is the
      // actual gate.
      onRisk: () => riskStore.open(),
    });

    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(onCommandMessage);
      stopIntercepting();
      stopLiveScan();
      stopPasteWatch();
      clearTimeout(clarifyTimer);
      stopClarifyWatch();
      clarifyStore.cancel();
      stopObserving();
      stopWatchingSettings();
      ui.remove();
    });
  },
});
