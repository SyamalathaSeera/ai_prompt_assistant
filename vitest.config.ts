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
 * The `ui` project gets jsdom, and is scoped to component tests only.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'lib',
          environment: 'node',
          include: ['lib/**/*.test.ts', 'test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['components/**/*.test.tsx', 'entrypoints/**/*.test.tsx'],
        },
      },
    ],
  },
});
