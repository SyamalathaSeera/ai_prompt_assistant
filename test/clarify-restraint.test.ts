import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '../lib/policy/defaults';
import { coerceSettings, migrateSettings } from '../lib/policy/migrate';

/**
 * Restraint, asserted structurally.
 *
 * Milestone 0.4.0.0 Task 4's success criterion is that *a user who ignores
 * this feature entirely notices no cost*. That is not something a behavioural
 * test can prove on its own — it is a claim about what the code is even
 * capable of doing. So the checks here are about wiring: the feature is off
 * unless asked for, and nothing on the path a prompt takes to leave the page
 * can reach it.
 */

const root = join(__dirname, '..');

function sourcesIn(dir: string): { path: string; source: string }[] {
  const files: { path: string; source: string }[] = [];

  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        files.push({ path: full, source: readFileSync(full, 'utf8') });
      }
    }
  };

  walk(dir);
  return files;
}

describe('off by default', () => {
  it('ships disabled', () => {
    // The only feature in the product that does. It volunteers an opinion
    // about what the user meant, which is the worst possible first impression.
    expect(DEFAULT_SETTINGS.clarifyEnabled).toBe(false);
  });

  it('stays off for an existing user updating into this build', () => {
    // Settings stored before the field existed must not acquire it switched on.
    const stored = { schemaVersion: 2, enabled: true };

    expect(migrateSettings(stored).clarifyEnabled).toBe(false);
    expect(coerceSettings(stored).clarifyEnabled).toBe(false);
  });

  it('keeps the choice of a user who turned it on', () => {
    expect(migrateSettings({ schemaVersion: 2, clarifyEnabled: true }).clarifyEnabled).toBe(
      true,
    );
  });

  it('refuses a non-boolean stored value rather than trusting it', () => {
    // The string "false" is truthy, and would silently invert the default.
    expect(coerceSettings({ clarifyEnabled: 'false' }).clarifyEnabled).toBe(false);
    expect(coerceSettings({ clarifyEnabled: 1 }).clarifyEnabled).toBe(false);
  });
});

describe('nothing on the send path can reach clarification', () => {
  it('keeps the interception layer free of any clarify dependency', () => {
    /*
     * The interception controller is what holds a submission. It has a reason
     * to pay that cost — a secret is about to leave — and an unsolicited
     * suggestion is not that reason.
     *
     * Asserted structurally rather than behaviourally: the guarantee is that
     * this code *cannot* delay a send, not merely that it currently does not.
     */
    const files = sourcesIn(join(root, 'lib', 'interception'));

    expect(files.length).toBeGreaterThan(0);
    for (const { path, source } of files) {
      expect(source, `${path} references clarification`).not.toMatch(/clarify|Clarify/);
    }
  });

  it('drives clarification from input, never from submit', () => {
    const source = readFileSync(join(root, 'entrypoints', 'content', 'index.ts'), 'utf8');

    // The only call site, and it hangs off the input watcher.
    const considerCalls = source.match(/clarifyStore\.consider\(\)/g) ?? [];
    expect(considerCalls).toHaveLength(1);

    const inputWatcher = /adapter\.onInput\?\.\(\(\) => \{[\s\S]*?\}\) \?\? \(\(\) => \{\}\)/.exec(
      source,
    );
    expect(inputWatcher, 'clarification is wired to onInput').not.toBeNull();
    expect(inputWatcher?.[0]).toContain('clarifyStore.consider()');
  });

  it('never awaits an interpretation', () => {
    // `void`, not `await`. Nothing may wait on this.
    const source = readFileSync(join(root, 'entrypoints', 'content', 'index.ts'), 'utf8');

    expect(source).toContain('void clarifyStore.consider()');
    expect(source).not.toMatch(/await\s+clarifyStore\.consider/);
  });

  it('is not passed to the interceptor', () => {
    const source = readFileSync(join(root, 'entrypoints', 'content', 'index.ts'), 'utf8');

    const interceptorCall = /createInterceptor\(\{[\s\S]*?\n {4}\}\)/.exec(source);
    expect(interceptorCall).not.toBeNull();
    expect(interceptorCall?.[0]).not.toMatch(/clarify/i);
  });
});
