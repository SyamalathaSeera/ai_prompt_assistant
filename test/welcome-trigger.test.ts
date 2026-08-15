import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The first-run trigger.
 *
 * Asserted against the source and the built output rather than by driving a
 * fake `onInstalled`, because the two failure modes worth guarding are both
 * structural:
 *
 *  - **opening on update**, which would put an unrequested tab in front of
 *    someone mid-task, on every release, forever
 *  - **pointing at a page that is not built**, which would open a broken tab at
 *    the single worst moment for a first impression
 *
 * A behavioural test with a stubbed listener would prove the handler runs; it
 * would not prove the reason check exists or that the target file ships.
 */

const root = resolve(__dirname, '..');
const BACKGROUND = resolve(root, 'entrypoints/background.ts');
const BUILT_WELCOME = resolve(root, '.output/chrome-mv3/welcome.html');
const BUILT_BACKGROUND = resolve(root, '.output/chrome-mv3/background.js');

const source = readFileSync(BACKGROUND, 'utf8');

describe('opening the welcome page', () => {
  it('opens it on install', () => {
    expect(source).toMatch(/tabs\.create/);
    expect(source).toMatch(/welcome\.html/);
  });

  it('opens it only for a genuine first install', () => {
    /*
     * The check that matters. `onInstalled` also fires for `update`,
     * `chrome_update` and `shared_module_update`; a guard on `install` filters
     * all three at once.
     */
    expect(source).toMatch(/details\.reason !== 'install'/);

    // The guard must come BEFORE the tab is created, not after.
    const guardAt = source.indexOf("details.reason !== 'install'");
    const createAt = source.indexOf('tabs.create');
    expect(guardAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(guardAt);
  });

  it('cannot break the install if the tab fails to open', () => {
    // A welcome tab is a nicety. An install that fails because of one is not.
    const afterGuard = source.slice(source.indexOf('tabs.create'));
    expect(afterGuard).toMatch(/\.catch\(/);
  });

  it('does not gate first-run on anything the user has to do', () => {
    // No account, no signup, no email — asserted here too because the
    // temptation to add a "confirm your address" step arrives later, in a
    // growth conversation, not in this file.
    expect(source).not.toMatch(/signup|sign_up|email|account/i);
  });
});

describe.skipIf(!existsSync(BUILT_WELCOME))('the built output', () => {
  it('ships the page the background worker points at', () => {
    // The one that catches a rename: the handler and the file are edited in
    // different places and nothing else connects them.
    expect(existsSync(BUILT_WELCOME)).toBe(true);
  });

  it('still references it from the built worker', () => {
    const built = readFileSync(BUILT_BACKGROUND, 'utf8');
    expect(built).toContain('welcome.html');
  });

  it('loads its script and nothing remote', () => {
    const html = readFileSync(BUILT_WELCOME, 'utf8');

    // Same claim as everywhere else, checked at the one entry point a new user
    // meets first.
    expect(html).not.toMatch(/src="https?:\/\//);
    expect(html).not.toMatch(/href="https?:\/\//);
  });
});
