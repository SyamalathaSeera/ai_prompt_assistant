import { useCallback, useEffect, useState } from 'preact/hooks';
import { ALL_RULES } from '@/lib/detector/rules';
import type { Rule } from '@/lib/detector/types';
import {
  hasPermission,
  PLATFORMS,
  requestPermission,
  revokePermission,
  type Platform,
} from '@/lib/adapters/platforms';
import { deleteAllData, getSettings, setSettings } from '@/lib/storage';
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
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    void hasPermission(platform).then(setGranted);
  }, [platform]);

  // Called straight from the click handler: awaiting first would lose the user
  // gesture, and Chrome rejects a permission request without one.
  const toggle = (next: boolean) => {
    setDenied(false);
    const action = next ? requestPermission(platform) : revokePermission(platform);
    void action.then((ok) => {
      if (next && !ok) setDenied(true);
      void hasPermission(platform).then(setGranted);
    });
  };

  return (
    <div>
      <Toggle
        testid={`platform-${platform.id}`}
        checked={platform.required || granted === true}
        disabled={platform.required || !platform.supported}
        onChange={toggle}
        label={platform.label}
        description={
          platform.required
            ? 'Granted at install. This is the only site requested up front.'
            : platform.supported
              ? 'Asks for permission when you turn it on.'
              : 'Support is not built yet.'
        }
      />
      {denied && (
        <p className="mt-1 text-xs" data-testid={`platform-denied-${platform.id}`}>
          Permission was declined, so {platform.label} is not protected. Nothing else
          changed.
        </p>
      )}
    </div>
  );
}

function Options() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [deleted, setDeleted] = useState(false);

  const load = useCallback(() => {
    void getSettings().then(setLocal);
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
          <dl className="grid gap-2">
            <div>
              <dt className="font-medium">What is read</dt>
              <dd className="opacity-70">
                The text in the message box on the sites above, while you are typing or
                pasting.
              </dd>
            </div>
            <div>
              <dt className="font-medium">What is stored on this device</dt>
              <dd className="opacity-70">
                These settings, a count of how many secrets were caught, and allowlisted
                values as one-way hashes. Real values are held in memory only, to restore
                replies, and are cleared when you close the browser.
              </dd>
            </div>
            <div>
              <dt className="font-medium">What is sent anywhere</dt>
              <dd className="opacity-70">
                Nothing. You can confirm this: open DevTools, use the extension, and watch
                the Network tab stay empty.
              </dd>
            </div>
          </dl>

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
    </main>
  );
}

export default Options;
