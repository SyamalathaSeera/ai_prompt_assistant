import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRIVACY_CLAIMS, SOURCE_URL } from '../components/PrivacyStatement';
import { PLATFORMS } from '../lib/adapters/platforms';

/**
 * The privacy statement, checked against reality.
 *
 * The milestone spec says these claims must "exactly match actual behavior
 * (re-verify before every release)". A note to re-verify is a note that will be
 * skipped, so this file does the verifying: each claim is cross-checked against
 * the built manifest, the shipped bundle, or the source it describes.
 *
 * The point is not that the wording is right. It is that a change in behaviour
 * which makes the wording *wrong* fails the build — because a privacy statement
 * that has quietly stopped being true is worse than none at all, and this is a
 * product whose entire pitch is that claim.
 */

const root = resolve(__dirname, '..');
const MANIFEST = resolve(root, '.output/chrome-mv3/manifest.json');
const CONTENT_SCRIPT = resolve(root, '.output/chrome-mv3/content-scripts/content.js');

const claim = (id: string) => {
  const found = PRIVACY_CLAIMS.find((c) => c.id === id);
  if (!found) throw new Error(`no privacy claim with id "${id}"`);
  return found.answer;
};

describe('every claim is backed by something checkable', () => {
  it('has an answer for each thing a user would ask', () => {
    // The set itself is the contract. Dropping one silently would leave a
    // question the screen no longer answers.
    expect(PRIVACY_CLAIMS.map((c) => c.id).sort()).toEqual([
      'access',
      'ai',
      'read',
      'sent',
      'stored',
    ]);
  });

  it('uses plain language, not legal boilerplate', () => {
    /*
     * A privacy policy is a separate document with a different job. This screen
     * has to be READ, and nobody reads defined terms.
     */
    const all = PRIVACY_CLAIMS.map((c) => c.answer).join(' ').toLowerCase();

    for (const term of [
      'hereby',
      'pursuant',
      'aforementioned',
      'third-party service providers',
      'we reserve the right',
      'data controller',
    ]) {
      expect(all, `boilerplate crept in: "${term}"`).not.toContain(term);
    }
  });
});

describe('"what it sends: nothing"', () => {
  it('says nothing, without qualification', () => {
    const answer = claim('sent').toLowerCase();

    expect(answer).toContain('nothing');
    // A hedge here would be the tell. "Only anonymous usage data" is how this
    // claim dies.
    for (const hedge of ['except', 'unless', 'aside from', 'other than', 'anonymous']) {
      expect(answer, `the claim is hedged with "${hedge}"`).not.toContain(hedge);
    }
  });

  it('names no analytics or crash reporting, because there is none', () => {
    expect(claim('sent').toLowerCase()).toContain('no analytics');
  });
});

describe.skipIf(!existsSync(CONTENT_SCRIPT))('the bundle backs the claim', () => {
  it('contains no network transport', () => {
    /*
     * Overlaps `test/no-network.test.ts` deliberately. That one guards the
     * architecture; this one guards the sentence on the screen — if transport
     * ever appears, the failure should point at the promise that just became
     * false, not only at the rule that was broken.
     */
    const source = readFileSync(CONTENT_SCRIPT, 'utf8');

    expect(source).not.toMatch(/XMLHttpRequest|new WebSocket|EventSource|navigator\.sendBeacon/);
  });
});

describe.skipIf(!existsSync(MANIFEST))('"what it can reach"', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    host_permissions: string[];
    optional_host_permissions: string[];
    permissions: string[];
  };

  it('names ChatGPT as the only site asked for at install', () => {
    // The claim on the screen and the string on Chrome's install dialog have
    // to agree, or the first thing the user reads is contradicted by the
    // second.
    expect(claim('access')).toMatch(/ChatGPT only/i);

    const hosts = manifest.host_permissions.join(' ');
    expect(hosts).toContain('chatgpt.com');
    expect(hosts).not.toContain('claude.ai');
    expect(hosts).not.toContain('gemini.google.com');
  });

  it('names exactly the platforms that are actually optional', () => {
    const optional = PLATFORMS.filter((p) => p.id !== 'chatgpt');

    for (const platform of optional) {
      expect(claim('access'), `${platform.label} is optional but unmentioned`).toContain(
        platform.label,
      );

      for (const origin of platform.origins) {
        expect(manifest.optional_host_permissions.join(' ')).toContain(
          origin.replace('https://', '').replace('/*', ''),
        );
      }
    }
  });

  it('asks for no permission the statement does not account for', () => {
    /*
     * The check that catches a quietly-added permission. `storage` is covered
     * by the "stored" claim and `scripting` by "access"; anything else means
     * the extension gained a capability the screen does not mention.
     */
    expect(manifest.permissions.sort()).toEqual(['scripting', 'storage']);
  });
});

describe('"what it stores"', () => {
  const storageSource = readFileSync(resolve(root, 'lib/storage/index.ts'), 'utf8');

  it('promises hashes for the allowlist, and stores hashes', () => {
    expect(claim('stored')).toMatch(/one-way hash/i);

    const allowlist = readFileSync(resolve(root, 'lib/policy/allowlist.ts'), 'utf8');
    expect(allowlist).toMatch(/SHA-256/i);
  });

  it('promises real values are memory-only, and uses session storage for them', () => {
    expect(claim('stored')).toMatch(/memory only/i);

    const vault = readFileSync(resolve(root, 'lib/vault/index.ts'), 'utf8');
    expect(vault).toContain('storage.session');
    expect(vault).not.toContain('storage.local');
  });

  it('never uses sync storage, which would leave the device', () => {
    // The claim is that nothing is sent anywhere. `.sync` would quietly send
    // settings to Google's servers and make the whole screen untrue.
    expect(storageSource).not.toContain('storage.sync');
  });
});

describe('"where the AI features run"', () => {
  it('promises on-device, and the model layer has no remote path', () => {
    expect(claim('ai')).toMatch(/on your machine|built into chrome/i);

    const files = readdirSync(resolve(root, 'lib/model'))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => readFileSync(join(root, 'lib/model', f), 'utf8'));

    expect(files.length).toBeGreaterThan(0);
    for (const source of files) {
      expect(source).not.toMatch(/fetch\(|XMLHttpRequest|api\.openai|anthropic/i);
    }
  });

  it('promises redaction before the model, and the guard enforces it', () => {
    expect(claim('ai')).toMatch(/redacted before/i);

    const guard = readFileSync(resolve(root, 'lib/refine/guard.ts'), 'utf8');
    expect(guard).toContain('prepareForModel');
  });
});

describe('the source link', () => {
  it('is absent until the repository is confirmed public', () => {
    /*
     * A dead link on the screen whose entire job is credibility does more
     * damage than no link: "here is the source" leading to a 404 reads as
     * something to hide. Flip this when the repo is public.
     */
    expect(SOURCE_URL).toBeNull();
  });
});
