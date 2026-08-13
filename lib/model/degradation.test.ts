import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getModelFeatures, isProtectionAvailable } from './features';
import { run } from './session';
import { __resetForTests } from './session';
import { detect, redact } from '../detector/engine';
import { ALL_RULES } from '../detector/rules';
import { createInterceptor } from '../interception/controller';
import { DEFAULT_SETTINGS } from '../policy/defaults';
import type { Disposer, SiteAdapter, SubmitIntent } from '../adapters/types';

/**
 * The degradation guarantee.
 *
 * Redaction is what people install this for; prompt improvement is an
 * addition. A machine that cannot run an on-device model must lose exactly the
 * model-backed features and **nothing else**.
 *
 * These tests run with the Prompt API removed entirely — the state on Firefox,
 * on older Chrome, and on hardware that cannot host the model. If any of them
 * fail, the model layer has leaked into the core product.
 */

const DOTENV = [
  'AWS_ACCESS_KEY_ID=AKIA3TZ2MRSYNTHETIC7',
  'DATABASE_URL=postgres://app:hunter2pass@db.internal:5432/orders',
  'STRIPE_SECRET_KEY=sk_live_9mQ4vX2nR7tK1pL5wZ8yB3cF',
].join('\n');

beforeEach(() => {
  // No LanguageModel, no ai.languageModel. This is the world for most users.
  vi.unstubAllGlobals();
  __resetForTests();
});

describe('with no model available at all', () => {
  it('still detects every secret', async () => {
    const findings = detect(DOTENV, {}, ALL_RULES);
    const blocking = findings.filter((f) => f.tier === 'high');

    expect(blocking.map((f) => f.ruleId).sort()).toEqual([
      'aws.access_key_id',
      'db.connection_string_password',
      'stripe.live_key',
    ]);
  });

  it('still redacts correctly', async () => {
    const findings = detect(DOTENV, {}, ALL_RULES);
    const { text } = redact(DOTENV, findings);

    expect(text).toContain('[REDACTED_');
    expect(text).not.toContain('AKIA3TZ2MRSYNTHETIC7');
    expect(text).not.toContain('hunter2pass');
  });

  it('still holds a submission containing a secret', () => {
    // The full interception path, with no model anywhere in the process.
    const composer = document.createElement('div');
    const handlers: ((intent: SubmitIntent) => void)[] = [];

    const adapter: SiteAdapter = {
      id: 'fake',
      hostPatterns: ['https://fake.test/*'],
      getComposer: () => composer,
      getText: () => DOTENV,
      setText: () => {},
      onSubmitIntent: (cb): Disposer => {
        handlers.push(cb);
        return () => {
          handlers.length = 0;
        };
      },
      checkHealth: () => ({
        composerFound: true,
        submitListenersAttached: true,
        resolvedVia: 'fake',
      }),
    };

    let held = false;
    createInterceptor({
      adapter,
      getSettings: () => DEFAULT_SETTINGS,
      onHeld: () => {
        held = true;
      },
    });

    const event = new Event('submit', { bubbles: true, cancelable: true });
    handlers[0]?.({ trigger: 'enter', event, release: () => {} });

    expect(held).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('reports protection as available regardless', () => {
    // An executable statement of the central commitment: detection depends on
    // nothing but the detector, which is pure.
    expect(isProtectionAvailable()).toBe(true);
  });
});

describe('what the user is told', () => {
  it('hides model features rather than disabling them', async () => {
    // A disabled control that can never be enabled is an unanswered question
    // in the interface. An absent one is simply a smaller product here.
    const features = await getModelFeatures();

    expect(features.showModelFeatures).toBe(false);
    expect(features.canRunNow).toBe(false);
  });

  it('explains the limitation in plain language', async () => {
    const features = await getModelFeatures();

    expect(features.explanation).toBeTruthy();
    expect(features.explanation).toContain('secrets are still detected and redacted');
  });

  it('never blames the user or implies something is broken', async () => {
    const features = await getModelFeatures();
    const text = (features.explanation ?? '').toLowerCase();

    for (const word of ['error', 'failed', 'unsupported browser', 'not supported']) {
      expect(text).not.toContain(word);
    }
  });
});

describe('the model layer itself', () => {
  it('returns a failure value instead of throwing', async () => {
    const result = await run('anything');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unavailable');
  });

  it('is safe to call repeatedly with no model', async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(run('x')).resolves.toMatchObject({ ok: false });
    }
  });
});

describe('layering', () => {
  it('keeps the detector free of any model dependency', async () => {
    // The detector must remain pure per ADR-004. If the model layer ever
    // leaks into it, the corpus suite stops being runnable without a browser
    // and the purity guarantee quietly dies.
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');

    const detectorDir = join(__dirname, '..', 'detector');
    const files: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          files.push(full);
        }
      }
    };
    walk(detectorDir);

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} references the model layer`).not.toMatch(
        /from '.*\/model|LanguageModel/,
      );
    }
  });
});
