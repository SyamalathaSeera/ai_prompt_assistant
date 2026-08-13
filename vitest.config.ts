import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

/**
 * Two test projects with deliberately different environments.
 *
 * The `lib` project runs in a Node environment with NO DOM. This is not a
 * performance choice — it mechanically enforces ADR-004 (detector purity).
 * If anything under lib/detector/ ever reaches for `document`, `window`, or
 * `chrome`, its tests fail immediately rather than passing quietly and
 * rotting the boundary.
 *
 * The `ui` project gets jsdom. Adapters, components, the vault, and
 * re-hydration live here because their job involves the DOM or extension
 * APIs — and keeping them OUT of the node project is what stops the
 * detector's purity guarantee from being quietly diluted to "most of lib/ is
 * pure".
 *
 * `WxtVitest` supplies WXT's path aliases (`@/*`) and auto-imports, so the
 * alias map has exactly one definition rather than a copy here that drifts.
 *
 * It is applied to the `ui` project ONLY. The plugin installs a fake `browser`
 * global, which would defeat the very assertion `test/environment.test.ts`
 * exists to make. Nothing in the `lib` project imports through the alias, so
 * excluding it costs nothing and keeps the detector's test environment
 * genuinely free of extension APIs rather than nominally so.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'lib',
          environment: 'node',
          include: [
            'lib/detector/**/*.test.ts',
            // policy/allowlist and policy/migrate are pure; policy has no
            // browser dependency of its own.
            'lib/policy/**/*.test.ts',
            'test/**/*.test.ts',
          ],
        },
      },
      {
        plugins: [WxtVitest()],
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: [
            'lib/adapters/**/*.test.ts',
            'lib/interception/**/*.test.ts',
            // The vault talks to chrome.storage, so it belongs with the
            // browser-dependent code rather than the pure `lib` project.
            'lib/vault/**/*.test.ts',
            'lib/rehydrate/**/*.test.ts',
            'lib/storage/**/*.test.ts',
            'components/**/*.test.{ts,tsx}',
            'entrypoints/**/*.test.{ts,tsx}',
          ],
        },
      },
    ],
  },
});
