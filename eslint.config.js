import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import autoImports from './.wxt/eslint-auto-imports.mjs';

/**
 * Lint config for AI Prompt Assistant.
 *
 * Beyond ordinary style rules, this file mechanically enforces two of the
 * project's non-negotiable architectural commitments (see CLAUDE.md and the
 * ADR log in ARCHITECTURE.md). Both are stated as rules elsewhere; stated
 * rules erode, enforced ones don't.
 */
export default tseslint.config(
  {
    ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'coverage/**', 'stats*.json'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // WXT auto-imports (defineContentScript, defineBackground, browser, ...)
  autoImports,

  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      // Underscore prefix marks an intentionally unused binding. Used heavily
      // by the not-yet-implemented module stubs, whose signatures are the
      // contract later milestones implement against.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  /**
   * ADR-001: no network requests.
   *
   * The product's core claim is that prompt content never leaves the device,
   * and that claim is the entire install-time pitch. A single fetch() in the
   * prompt path invalidates it. Enforced repo-wide.
   *
   * The one sanctioned exception is the remote selector config in milestone
   * 0.2.0.2 — background worker only, config data only, never the prompt path.
   * When that lands, add a narrowly scoped override here rather than deleting
   * this rule.
   */
  {
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'ADR-001: no network requests. Prompt content must never leave the device.',
        },
        {
          name: 'XMLHttpRequest',
          message:
            'ADR-001: no network requests. Prompt content must never leave the device.',
        },
        {
          name: 'WebSocket',
          message:
            'ADR-001: no network requests. Prompt content must never leave the device.',
        },
      ],
    },
  },

  /**
   * ADR-004: the detector is pure.
   *
   * lib/detector/ takes a string and returns findings. No DOM, no extension
   * APIs, no I/O. This is what makes detection quality measurable — the
   * corpus suite in milestone 0.0.2.0 runs in milliseconds with no browser,
   * so precision and recall can gate CI.
   *
   * Note that TypeScript alone cannot catch this: WXT's generated tsconfig
   * includes "DOM" in `lib`, so `document` typechecks fine anywhere. This
   * override is the import-side enforcement; the Vitest `lib` project's node
   * environment is the runtime-side enforcement.
   */
  {
    files: ['lib/detector/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'document',
          message: 'ADR-004: the detector must be pure. No DOM access.',
        },
        { name: 'window', message: 'ADR-004: the detector must be pure. No DOM access.' },
        {
          name: 'localStorage',
          message: 'ADR-004: the detector must be pure. No storage access.',
        },
        {
          name: 'sessionStorage',
          message: 'ADR-004: the detector must be pure. No storage access.',
        },
        {
          name: 'chrome',
          message: 'ADR-004: the detector must be pure. No extension APIs.',
        },
        {
          name: 'browser',
          message: 'ADR-004: the detector must be pure. No extension APIs.',
        },
        { name: 'fetch', message: 'ADR-001 + ADR-004: no network requests.' },
        { name: 'XMLHttpRequest', message: 'ADR-001 + ADR-004: no network requests.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**', '@/lib/adapters/**'],
              message:
                'ADR-004: the detector must not depend on host-page knowledge. Adapters call the detector, never the reverse.',
            },
            {
              group: [
                '**/lib/storage/**',
                '**/lib/vault/**',
                '@/lib/storage/**',
                '@/lib/vault/**',
              ],
              message:
                'ADR-004: the detector must be free of I/O. Callers read storage and pass values in.',
            },
            {
              group: ['wxt/browser', 'wxt/storage', '#imports'],
              message: 'ADR-004: the detector must not use extension APIs.',
            },
          ],
        },
      ],
    },
  },

  // Test files may reach for globals the source is forbidden from touching,
  // since asserting their absence is the point.
  {
    files: ['test/**/*.ts', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },

  prettier,
);
