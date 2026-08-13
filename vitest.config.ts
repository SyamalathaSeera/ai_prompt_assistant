import { defineConfig } from 'vitest/config';

/**
 * Two test projects with deliberately different environments.
 *
 * The `lib` project runs in a Node environment with NO DOM. This is not a
 * performance choice — it mechanically enforces ADR-004 (detector purity).
 * If anything under lib/detector/ ever reaches for `document`, `window`, or
 * `chrome`, its tests fail immediately rather than passing quietly and
 * rotting the boundary.
 *
 * The `ui` project gets jsdom. Adapters live here because their entire job is
 * knowing what a host page's DOM looks like — and keeping them OUT of the node
 * project is what stops the detector's purity guarantee from being quietly
 * diluted to "most of lib/ is pure".
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
            'lib/policy/**/*.test.ts',
            'test/**/*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: [
            'lib/adapters/**/*.test.ts',
            'lib/interception/**/*.test.ts',
            'components/**/*.test.tsx',
            'entrypoints/**/*.test.tsx',
          ],
        },
      },
    ],
  },
});
