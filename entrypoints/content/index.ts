import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { h, render } from 'preact';
import { detectTheme, observeTheme } from '@/components/theme';
import { createPanelStore } from '@/components/panel-store';
import { createRiskStore } from '@/components/risk-store';
import { createRefineStore } from '@/components/refine-store';
import { createClarifyStore } from '@/components/clarify-store';
import { getModelFeatures } from '@/lib/model';
import { Panel } from '@/components/Panel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { resolveAdapter } from '@/lib/adapters/registry';
import { createInterceptor } from '@/lib/interception/controller';
import { createLiveScanner } from '@/lib/interception/live-scan';
import { createPasteWatcher } from '@/lib/interception/paste';
import { detect, redact } from '@/lib/detector/engine';
import { findPlaceholders, hydrate, needsHydration } from '@/lib/rehydrate';
import { resolve as resolveFromVault } from '@/lib/vault';
import { prepareRedaction } from '@/lib/vault/prepare';
import { getSettingsSync, initSettings, recordCatch, recordHealth, setSettings } from '@/lib/storage';
import { createHealthMonitor } from '@/lib/health';
import { recordError } from '@/lib/errors';
import type { HealthReport } from '@/lib/health';
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

    let submissionGeneration = 0;

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
      onApplyRedaction: async (text) => {
        const composer = adapter.getComposer();
        if (!composer) throw new Error('Composer unavailable');
        const original = adapter.getText(composer);
        const snapshot = riskStore.get();
        if (snapshot.text !== original) throw new Error('Draft changed');
        const findings = redact(original, snapshot.findings).text === text
          ? snapshot.findings : detect(original);
        const scope = conversationId();
        const prepared = await prepareRedaction(original, text, findings, scope, getSettings().rehydrateResponses);
        if (conversationId() !== scope || adapter.getComposer() !== composer || adapter.getText(composer) !== original) {
          throw new Error('Draft changed');
        }
        adapter.setText(composer, prepared);
      },
    });

    let mountedIn: HTMLElement | undefined;
    let stopThemeWatch: (() => void) | undefined;

    /**
     * Whether protection is actually working on this page.
     *
     * Held here and pushed into the Panel on change, rather than living in a
     * store, because it has exactly one writer and the UI only reads it.
     */
    let health: HealthReport = {
      level: 'healthy',
      resolvedVia: null,
      composerFound: true,
      submitListenersAttached: true,
      attempts: 0,
    };

    /** Re-renders the panel. Called when health changes. */
    let repaint: () => void = () => {};

    /**
     * Set once the injected UI has crashed.
     *
     * From that point the extension must stop holding submissions. The
     * reasoning is uncomfortable but not close: interception is only safe
     * because there is a UI to resolve what it holds. Without one, every held
     * prompt is a prompt the user cannot send — so we stop protecting and say
     * so loudly, rather than protecting in a way that traps them.
     */
    let uiBroken = false;

    /**
     * The single response to any UI crash, wherever it was caught.
     *
     * `store.dismiss()` runs first and is the safety argument: dismissal leaves
     * the user's text in the composer, unsent. Releasing would send the
     * original — secrets included — at precisely the moment we lost the ability
     * to warn them about it.
     */
    const handleUiError = (error: unknown) => {
      uiBroken = true;
      health = { ...health, level: 'unavailable', resolvedVia: null };

      try {
        store.dismiss();
      } catch {
        /* the store is already unusable; the rest still has to happen */
      }

      void recordError('ui.panel', error);
      void recordHealth(location.hostname, {
        level: 'unavailable',
        resolvedVia: null,
        at: Date.now(),
      });

      // Repaint so the health notice appears. It renders outside the boundary
      // precisely so it can still be shown after this.
      repaint();
    };

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

        repaint = () => {
          /*
           * A boundary here as well as inside the Panel.
           *
           * The inner ones isolate an individual surface. This one catches what
           * they structurally cannot: a throw in the Panel's own body — a hook,
           * a store read, the prop wiring itself — which happens before any
           * inner boundary exists to catch it. Found by a test that expected
           * the inner boundary to be enough and was wrong.
           */
          render(
            h(
              ErrorBoundary,
              { onError: handleUiError },
              h(Panel, {
                store,
                riskStore,
                refineStore,
                clarifyStore,
                getComposer: () => adapter.getComposer(),
                refineAvailable,
                health: health.level,
                healthResolvedVia: health.resolvedVia,
                onUiError: handleUiError,
              }),
            ),
            container,
          );
        };

        repaint();
        mountedIn = container;
        return container;
      },

      onRemove: () => {
        stopThemeWatch?.();
        stopThemeWatch = undefined;
        repaint = () => {};
        // Preact unmounts by rendering null into the same container.
        if (mountedIn) render(null, mountedIn);
        mountedIn = undefined;
      },
    });

    ui.mount();

    /**
     * Is this page actually protected?
     *
     * Started after mount so the first report has somewhere to render. Retries
     * on a backoff, because the usual reason a first check fails is that we
     * arrived before the composer did — treating that as breakage would show
     * "protection unavailable" on nearly every page load.
     *
     * Nothing here is transmitted. The report is rendered locally and written
     * to session storage so the popup can answer the same question.
     */
    const healthMonitor = createHealthMonitor({
      adapter,
      onChange: (report) => {
        health = report;
        repaint();

        console.log(
          `[APA] protection ${report.level}` +
            (report.resolvedVia ? ` (via ${report.resolvedVia})` : ''),
        );

        void recordHealth(location.hostname, {
          level: report.level,
          resolvedVia: report.resolvedVia,
          at: Date.now(),
        });
      },
    });

    /**
     * Wakes the monitor when the page changes underneath us.
     *
     * SPA navigation swaps the composer without reloading, so a page that was
     * healthy can become unavailable — or, more usefully, one that had given up
     * can recover. Throttled hard: this fires constantly on a streaming reply,
     * and a health check per mutation would be its own performance bug.
     */
    let recheckTimer: ReturnType<typeof setTimeout> | undefined;
    const healthObserver = new MutationObserver(() => {
      if (recheckTimer !== undefined) return;
      recheckTimer = setTimeout(() => {
        recheckTimer = undefined;
        healthMonitor.recheck();
      }, 2000);
    });
    healthObserver.observe(document.body, { childList: true, subtree: true });

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
        const generation = ++submissionGeneration;
        const scope = conversationId();
        void (async () => {
          /*
           * No UI, no holding.
           *
           * Checked here rather than by tearing down the interceptor, because
           * this path is also what releases a submission that was cancelled
           * microseconds before the crash. Disposing the listener would leave
           * that one stranded — the exact failure this task exists to remove.
           */
          if (uiBroken) {
            submission.sendOriginal();
            return;
          }

          const blocking = await applyAllowlist(submission.text, submission.blocking);

          // Everything blocking was allowlisted, so there is nothing to ask
          // about — release the submission rather than showing an empty modal.
          if (blocking.length === 0) {
            submission.sendOriginal();
            return;
          }

          for (const finding of blocking) void recordCatch(finding.ruleId);

          const findings = await applyAllowlist(submission.text, submission.findings);
          if (generation !== submissionGeneration || scope !== conversationId()) return;
          store.present({
            ...submission,
            blocking,
            findings,
            sendReplacement: async (replacement) => {
              const composer = adapter.getComposer();
              if (!composer || adapter.getText(composer) !== submission.text) throw new Error('Draft changed');
              const prepared = await prepareRedaction(submission.text, replacement, findings, scope, getSettings().rehydrateResponses);
              if (generation !== submissionGeneration || scope !== conversationId() ||
                  adapter.getComposer() !== composer || adapter.getText(composer) !== submission.text) {
                throw new Error('Draft changed');
              }
              await submission.sendReplacement(prepared);
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
            if (!turn.isConnected || scope !== conversationId() || !getSettings().rehydrateResponses) return;
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
      /**
       * A scan that blew the budget.
       *
       * The hook existed since 0.0.3.0 and was never connected to anything,
       * which made it a measurement nobody could see. Recording it means a
       * performance problem on a real page arrives as a line in the options
       * page rather than as a vague report that "it feels slow".
       *
       * Receives timing and length only — never the text.
       */
      onSlowScan: ({ durationMs, length }) => {
        void recordError(
          'perf.live-scan',
          new Error(`scan took ${durationMs.toFixed(0)}ms on ${length} chars`),
        );
      },
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
      healthMonitor.stop();
      healthObserver.disconnect();
      if (recheckTimer !== undefined) clearTimeout(recheckTimer);
      stopObserving();
      stopWatchingSettings();
      ui.remove();
    });
  },
});
