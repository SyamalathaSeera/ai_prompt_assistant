import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';
import type { SiteAdapter } from './types';

/**
 * Hostname -> adapter resolution.
 *
 * Milestone 0.1.0.0 registers the Claude and Gemini adapters here. Adding a
 * platform should mean adding one entry plus one adapter file.
 */
const ADAPTERS: readonly SiteAdapter[] = [chatgptAdapter, claudeAdapter, geminiAdapter];

/**
 * Hostnames each adapter claims.
 *
 * Kept separate from the glob match patterns in the adapter, which exist for
 * the manifest. These are compared against `location.hostname`.
 */
const HOSTNAMES: Readonly<Record<string, readonly string[]>> = {
  chatgpt: ['chatgpt.com', 'chat.openai.com'],
  claude: ['claude.ai'],
  gemini: ['gemini.google.com'],
};

/**
 * Returns the adapter for a hostname, or null when the host is unsupported.
 *
 * A null result is a normal, quiet no-op — not an error and not something to
 * log. The content script only runs on hosts in the manifest, so the common
 * path here is a match; the null path exists so a future dynamic registration
 * or an unexpected frame cannot throw.
 */
export function resolveAdapter(hostname: string): SiteAdapter | null {
  const host = normalizeHostname(hostname);
  if (host === '') return null;

  for (const adapter of ADAPTERS) {
    const claimed = HOSTNAMES[adapter.id] ?? [];
    if (claimed.some((h) => host === h || host.endsWith(`.${h}`))) {
      return adapter;
    }
  }

  return null;
}

/**
 * Lowercases, strips a leading `www.`, and drops any port.
 *
 * Matching on a raw hostname would miss `WWW.ChatGPT.com` and would treat
 * `chatgpt.com:443` as unsupported. Note the suffix match in `resolveAdapter`
 * anchors on a leading dot, so `notchatgpt.com` cannot masquerade as a
 * subdomain of a supported host.
 */
function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
}

/** All registered adapters. Used by the conformance suite in milestone 0.1.0.0. */
export function allAdapters(): readonly SiteAdapter[] {
  return ADAPTERS;
}

/** Whether any adapter claims this hostname. */
export function isSupportedHost(hostname: string): boolean {
  return resolveAdapter(hostname) !== null;
}
