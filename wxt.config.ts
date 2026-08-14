import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

// See https://wxt.dev/api/config.html
/**
 * Preact rather than React, decided at milestone 0.0.4.0.
 *
 * The content script runs on every ChatGPT page load, and bundling React put
 * it at 202.9 kB against a PRD requirement not to degrade host page
 * performance. Preact provides the same component model at a fraction of the
 * size. Switched while exactly one component existed, which is the cheapest
 * this change was ever going to be.
 *
 * Native Preact, not `preact/compat`: no alias layer to maintain and no
 * mismatch between `@types/react` and the actual runtime.
 */
export default defineConfig({

  // WXT would otherwise launch a fresh Chrome profile via web-ext. A blank
  // profile is not signed in to ChatGPT, which makes verifying against the
  // real page awkward. Load unpacked into the normal profile instead.
  webExt: {
    disabled: true,
  },

  manifest: {
    // PROVISIONAL NAME. Chrome Web Store policy restricts implying affiliation
    // with another company's product, so this must be checked against current
    // policy before the 0.9.0.1 listing draft. Renaming after launch forfeits
    // accumulated reviews and search ranking.
    name: 'AI Prompt Assistant',
    description:
      'Detects and redacts secrets and sensitive data in AI chat prompts before they are sent. Runs entirely on your device.',

    // Install-time permissions are deliberately minimal. Every host on the
    // install warning screen costs conversion, and the product's pitch is that
    // nothing leaves the machine — so we ask for one site and no more.
    // `scripting` is needed to register content scripts for platforms the user
    // enables after install. It grants no host access on its own — injection
    // still requires the host permission the user has just approved — and
    // Chrome does not surface it as a warning on the install screen, so the
    // install ask remains ChatGPT only. Asserted in the manifest test.
    permissions: ['storage', 'scripting'],
    host_permissions: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],

    // Additional platforms are requested at the moment the user enables them
    // in options (milestone 0.1.0.0), never up front.
    optional_host_permissions: ['https://claude.ai/*', 'https://gemini.google.com/*'],

    /**
     * The refinement shortcut.
     *
     * Declared as a browser command rather than a `keydown` listener in the
     * content script for two reasons. Chrome lets the user rebind it at
     * chrome://extensions/shortcuts, and it refuses to register a binding that
     * collides with the browser's own — neither of which we could offer by
     * listening on the page. It also cannot fire while the user is typing into
     * some other application's editor, which a document-level listener would.
     *
     * Alt rather than Ctrl+Shift: Ctrl+Shift+I is devtools, and most of the
     * remaining Ctrl+Shift space is taken by the host pages themselves.
     */
    commands: {
      'refine-prompt': {
        suggested_key: { default: 'Alt+Shift+I', mac: 'Alt+Shift+I' },
        description: 'Improve the prompt in the composer',
      },
    },

    // NOTE: action.default_title is NOT set here. WXT derives it from the
    // <title> of entrypoints/popup/index.html and overrides anything set in
    // this block. Change the title there instead.
  },

  vite: () => ({
    plugins: [preact(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  }),
});
