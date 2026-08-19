import { useCallback, useEffect, useState } from 'preact/hooks';
import { ALL_RULES } from '@/lib/detector/rules';
import type { Rule } from '@/lib/detector/types';
import {
  disablePlatform,
  enablePlatform,
  hasPermission,
  PLATFORMS,
  type Platform,
} from '@/lib/adapters/platforms';
import { deleteAllData, getSettings, setSettings } from '@/lib/storage';
import { clearErrors, formatForReport, getErrors, type LoggedError } from '@/lib/errors';
import { ModelDownload } from '@/components/ModelDownload';
import { PrivacyStatement } from '@/components/PrivacyStatement';
import { getModelFeatures, type ModelFeatures } from '@/lib/model';
import { STYLES, type RefinementStyle } from '@/lib/refine';
import { removeFromAllowlist } from '@/lib/policy/allowlist';
import type { Settings } from '@/lib/policy/schema';

/**
 * Options page.
 *
 * Two obligations beyond the toggles. First, every rule is described in plain
 * language, sourced from the rule itself — a settings page that misdescribes
 * what it controls is worse than one with no descriptions. Second, the privacy
 * section states exactly what is stored and offers a delete that really
 * deletes, because "we store nothing you can't remove" is only a claim until
 * there is a button.
 */

interface Section {
  title: string;
  hint?: string;
  children: preact.ComponentChildren;
}

function Section({ title, hint, children }: Section) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {hint && <p className="mt-1 text-xs opacity-60">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
  testid,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  testid: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-current/10 p-3">
      <input
        type="checkbox"
        data-testid={testid}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {description && <span className="mt-0.5 block text-xs opacity-60">{description}</span>}
      </span>
    </label>
  );
}

function RuleGroup({
  title,
  hint,
  rules,
  settings,
  onToggle,
}: {
  title: string;
  hint: string;
  rules: readonly Rule[];
  settings: Settings;
  onToggle: (ruleId: string, enabled: boolean) => void;
}) {
  if (rules.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">{title}</h3>
      <p className="mt-1 text-xs opacity-60">{hint}</p>
      <div className="mt-2 grid gap-2">
        {rules.map((rule) => (
          <Toggle
            key={rule.id}
            testid={`rule-${rule.id}`}
            checked={!settings.disabledRuleIds.includes(rule.id)}
            onChange={(enabled) => onToggle(rule.id, enabled)}
            label={rule.label}
            description={rule.description}
          />
        ))}
      </div>
    </div>
  );
}

function PlatformRow({ platform }: { platform: Platform }) {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [outcome, setOutcome] = useState<'denied' | 'failed' | null>(null);

  useEffect(() => {
    void hasPermission(platform).then(setGranted);
  }, [platform]);

  /**
   * Called straight from the click handler.
   *
   * `permissions.request()` must run inside the user gesture — awaiting
   * anything first loses it and Chrome rejects the request outright. So the
   * async work is started here and its result handled in a `.then`, rather
   * than making this handler `async`.
   */
  const toggle = (next: boolean) => {
    setOutcome(null);

    if (!next) {
      void disablePlatform(platform).then(() => {
        void hasPermission(platform).then(setGranted);
      });
      return;
    }

    void enablePlatform(platform).then((result) => {
      if (result !== 'enabled') setOutcome(result);
      void hasPermission(platform).then(setGranted);
    });
  };

  const description = platform.required
    ? 'Granted at install. This is the only site requested up front.'
    : (platform.limitation ?? 'Asks for permission when you turn it on.');

  return (
    <div>
      <Toggle
        testid={`platform-${platform.id}`}
        checked={platform.required || granted === true}
        disabled={platform.required || !platform.supported}
        onChange={toggle}
        label={platform.label}
        description={description}
      />

      {/*
        "You declined" and "it broke" need different words: the first is the
        user's own choice and needs no apology, the second is our problem.
      */}
      {outcome === 'denied' && (
        <p className="mt-1 text-xs" data-testid={`platform-denied-${platform.id}`}>
          Permission was declined, so {platform.label} is not protected. Nothing else
          changed.
        </p>
      )}
      {outcome === 'failed' && (
        <p className="mt-1 text-xs" data-testid={`platform-failed-${platform.id}`}>
          Permission was granted but {platform.label} could not be set up. Try turning it
          off and on again.
        </p>
      )}
    </div>
  );
}

/**
 * Prompt improvement.
 *
 * The button in the composer is hidden on hardware that cannot run a model, so
 * this section is where its absence is explained. Without it, a user whose
 * browser lacks the model sees a feature described everywhere else and simply
 * missing from their screen.
 *
 * It is one of the two places the one-time download can be started, the other
 * being the welcome page. `run()` deliberately never triggers it — a
 * hundreds-of-megabytes download is not something a keystroke should start on
 * a metered connection — so any surface that reports "needs downloading" has
 * to offer a way out, or the state is a dead end. Both share
 * `ModelDownload` rather than the control existing twice.
 */
function ImprovementSection({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [features, setFeatures] = useState<ModelFeatures | null>(null);

  const refresh = useCallback(() => {
    void getModelFeatures().then(setFeatures);
  }, []);

  useEffect(refresh, [refresh]);

  if (!features) return null;

  return (
    <Section
      title="Prompt improvement"
      hint="Rewrites a rough prompt into a clearer one. It runs on this device, and your prompt is redacted before the model sees it."
    >
      {!features.showModelFeatures && (
        <p className="text-sm opacity-70" data-testid="model-unavailable">
          {features.explanation}
        </p>
      )}

      {features.showModelFeatures && (
        <div className="grid gap-3">
          <label className="grid gap-1 rounded-lg border border-current/10 p-3">
            <span className="text-sm">Improve prompts by default</span>
            <span className="text-xs opacity-60">
              You can pick a different one for a single prompt from the composer.
            </span>
            <select
              data-testid="setting-refine-style"
              className="mt-1 rounded-md border border-current/20 bg-transparent p-1.5 text-sm"
              value={settings.refineStyle}
              onChange={(event) =>
                void update({
                  refineStyle: (event.currentTarget as HTMLSelectElement)
                    .value as RefinementStyle,
                })
              }
            >
              {STYLES.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.label} — {style.description}
                </option>
              ))}
            </select>
          </label>

          <p className="text-xs opacity-60" data-testid="model-shortcut">
            Keyboard shortcut: Alt+Shift+I. Change it at chrome://extensions/shortcuts.
          </p>

          {features.needsDownload && (
            <div className="rounded-lg border border-current/10 p-3">
              <p className="text-sm">{features.explanation}</p>
              <div className="mt-2">
                <ModelDownload onSettled={refresh} />
              </div>
            </div>
          )}

          {features.capability.availability === 'downloading' && (
            <p className="text-xs opacity-60" data-testid="model-downloading">
              {features.explanation}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

function Options() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [errors, setErrors] = useState<LoggedError[]>([]);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    void getSettings().then(setLocal);
    void getErrors().then(setErrors);
  }, []);

  useEffect(load, [load]);

  const update = async (patch: Partial<Settings>) => setLocal(await setSettings(patch));

  if (!settings) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p className="text-sm opacity-60">Loading…</p>
      </main>
    );
  }

  const toggleRule = (ruleId: string, enabled: boolean) =>
    update({
      disabledRuleIds: enabled
        ? settings.disabledRuleIds.filter((id) => id !== ruleId)
        : [...settings.disabledRuleIds, ruleId],
    });

  const high = ALL_RULES.filter((r) => r.tier === 'high');
  const low = ALL_RULES.filter((r) => r.tier === 'low');

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-lg font-semibold tracking-tight">AI Prompt Assistant</h1>
      <p className="mt-1 text-sm opacity-70">
        Detection runs entirely on this device. Nothing you type is ever sent anywhere.
      </p>

      <Section title="Protection">
        <div className="grid gap-2">
          <Toggle
            testid="setting-enabled"
            checked={settings.enabled}
            onChange={(enabled) => update({ enabled })}
            label="Protection on"
            description="Turn everything off without uninstalling."
          />
          <Toggle
            testid="setting-block"
            checked={settings.highTierBehavior === 'block'}
            onChange={(block) => update({ highTierBehavior: block ? 'block' : 'warn' })}
            label="Hold the message when a secret is found"
            description="Off: you are told, but the message still sends."
          />
          <Toggle
            testid="setting-paste"
            checked={settings.scanOnPaste}
            onChange={(scanOnPaste) => update({ scanOnPaste })}
            label="Check what you paste"
            description="Paste is where secrets usually arrive, so this warns you early."
          />
          <Toggle
            testid="setting-rehydrate"
            checked={settings.rehydrateResponses}
            onChange={(rehydrateResponses) => update({ rehydrateResponses })}
            label="Restore real values in replies"
            description="Shows your real values back to you where a reply repeats a placeholder. They never leave this device."
          />
          <Toggle
            testid="setting-clarify"
            checked={settings.clarifyEnabled}
            onChange={(clarifyEnabled) => update({ clarifyEnabled })}
            label="Ask what vague references mean"
            description="Off by default. When a message says 'add this over there', offers one reading of it — with the earlier message it came from — before you send. Never changes anything without you saying yes."
          />
          <Toggle
            testid="setting-dummy"
            checked={settings.placeholderStyle === 'dummy'}
            onChange={(dummy) =>
              update({ placeholderStyle: dummy ? 'dummy' : 'bracketed' })
            }
            label="Use dummy-style placeholders"
            description="dummy_api_key_1 instead of [REDACTED_API_KEY_1]. Try this if a model comments on the redaction instead of doing the task."
          />
        </div>
      </Section>

      <ImprovementSection settings={settings} update={update} />

      <Section
        title="What to look for"
        hint="Turning a family off stops it being detected at all."
      >
        <RuleGroup
          title="Secrets"
          hint="These hold your message back, because a false alarm here is nearly impossible."
          rules={high}
          settings={settings}
          onToggle={toggleRule}
        />
        <RuleGroup
          title="Personal information"
          hint="These only suggest. They never hold a message back."
          rules={low}
          settings={settings}
          onToggle={toggleRule}
        />
      </Section>

      <Section
        title="Sites"
        hint="Only ChatGPT is requested when you install. Anything else asks at the moment you turn it on."
      >
        <div className="grid gap-2">
          {PLATFORMS.map((platform) => (
            <PlatformRow key={platform.id} platform={platform} />
          ))}
        </div>
      </Section>

      <Section
        title="Never flagged"
        hint="Values you told us to ignore. They are stored as one-way hashes, so they can be recognised but never shown here or recovered by anyone."
      >
        {settings.allowlist.length === 0 ? (
          <p className="text-sm opacity-60" data-testid="allowlist-empty">
            Nothing yet. Use “Never flag” when a warning is about a value you know is
            safe.
          </p>
        ) : (
          <div className="grid gap-2">
            {settings.allowlist.map((entry) => (
              <div
                key={entry.hash}
                data-testid="allowlist-entry"
                className="flex items-center justify-between gap-3 rounded-lg border border-current/10 p-3"
              >
                <span className="min-w-0">
                  <span className="block text-sm">{entry.label}</span>
                  <span className="mt-0.5 block text-xs opacity-60">
                    {entry.addedAt ? `Added ${entry.addedAt}` : 'Added before this was recorded'}
                  </span>
                </span>
                <button
                  type="button"
                  data-testid={`allowlist-remove-${entry.hash.slice(0, 8)}`}
                  onClick={() =>
                    update({ allowlist: removeFromAllowlist(entry.hash, settings.allowlist) })
                  }
                  className="shrink-0 rounded-md border border-current/25 px-2.5 py-1.5 text-xs"
                >
                  Start flagging again
                </button>
              </div>
            ))}

            <button
              type="button"
              data-testid="allowlist-clear"
              onClick={() => update({ allowlist: [] })}
              className="mt-1 self-start rounded-md border border-current/25 px-2.5 py-1.5 text-xs"
            >
              Clear all {settings.allowlist.length}
            </button>
          </div>
        )}
      </Section>

      <Section title="Your data">
        <div className="rounded-lg border border-current/10 p-4 text-sm">
          {/*
            The same component the welcome page renders. This section used to
            carry its own hand-written copy, which meant the product made two
            privacy statements that had to be kept in agreement by memory.
          */}
          <PrivacyStatement compact />

          <button
            type="button"
            data-testid="delete-all"
            onClick={() =>
              void deleteAllData().then(() => {
                setDeleted(true);
                load();
              })
            }
            className="mt-4 rounded-md border border-current/25 px-3 py-1.5 text-xs"
          >
            Delete everything stored
          </button>
          {deleted && (
            <p className="mt-2 text-xs" data-testid="delete-confirmed">
              Everything was deleted and settings are back to their defaults.
            </p>
          )}
        </div>
      </Section>

      {/*
        The log exists so a bug can be reported without pasting a prompt into
        an issue tracker. There is no telemetry in this product and there is
        not going to be, so the alternative is asking people to describe
        crashes from memory.

        Hidden entirely when empty. An always-visible "Errors (0)" panel invites
        people to go looking for problems they do not have.
      */}
      {errors.length > 0 && (
        <Section title="Problems">
          <div className="rounded-lg border border-current/10 p-4 text-sm">
            <p className="opacity-70">
              {errors.length === 1
                ? 'One problem was recorded on this device.'
                : `${errors.length} problems were recorded on this device.`}{' '}
              Nothing here has been sent anywhere, and secrets are removed before
              anything is written down. You can paste this into a bug report.
            </p>

            <ul data-testid="error-log" className="mt-3 grid gap-2">
              {errors.map((error) => (
                <li
                  key={`${error.at}:${error.where}`}
                  data-testid="error-entry"
                  className="rounded-md border border-current/10 p-2 font-mono text-xs"
                >
                  <div className="opacity-60">
                    {new Date(error.at).toLocaleString()} · {error.where}
                  </div>
                  <div className="mt-1 break-words">{error.message}</div>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="copy-errors"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(formatForReport(errors))
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
                className="rounded-md border border-current/25 px-3 py-1.5 text-xs"
              >
                {copied ? 'Copied' : 'Copy for a bug report'}
              </button>

              <button
                type="button"
                data-testid="clear-errors"
                onClick={() => void clearErrors().then(load)}
                className="rounded-md border border-current/25 px-3 py-1.5 text-xs"
              >
                Clear
              </button>
            </div>
          </div>
        </Section>
      )}
    </main>
  );
}

export default Options;
