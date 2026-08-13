import { chatgptAdapter } from './chatgpt';
import type { SiteAdapter } from './types';

/**
 * Hostname -> adapter resolution.
 *
 * Milestone 0.1.0.0 registers the Claude and Gemini adapters here. Adding a
 * platform should mean adding one entry plus one adapter file.
 */
const ADAPTERS: readonly SiteAdapter[] = [chatgptAdapter];

/** Hostnames each adapter claims, kept separate from the glob match patterns. */
const HOSTNAMES: Readonly<Record<string, string[]>> = {
  chatgpt: ['chatgpt.com', 'chat.openai.com'],
};

/**
 * Returns the adapter for a hostname, or null when the host is unsupported.
 *
 * A null result is a normal, quiet no-op — not an error and not something to
 * log. The content script simply does nothing on pages we do not handle.
 */
export function resolveAdapter(hostname: string): SiteAdapter | null {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  for (const adapter of ADAPTERS) {
    const hosts = HOSTNAMES[adapter.id] ?? [];
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return adapter;
    }
  }
  return null;
}

/** All registered adapters. Used by the conformance suite in milestone 0.1.0.0. */
export function allAdapters(): readonly SiteAdapter[] {
  return ADAPTERS;
}
