import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

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
    permissions: ['storage'],
    host_permissions: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],

    // Additional platforms are requested at the moment the user enables them
    // in options (milestone 0.1.0.0), never up front.
    optional_host_permissions: ['https://claude.ai/*', 'https://gemini.google.com/*'],

    // NOTE: action.default_title is NOT set here. WXT derives it from the
    // <title> of entrypoints/popup/index.html and overrides anything set in
    // this block. Change the title there instead.
  },

  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  }),
});
