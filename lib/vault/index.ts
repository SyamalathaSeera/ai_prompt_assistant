import { browser } from 'wxt/browser';
import type { VaultEntry, VaultRequest, VaultResponse } from './service';

export { MAX_ENTRIES, TTL_MS } from './limits';
export type { VaultEntry } from './service';

/** Session vault RPC. Only the background service writes storage.session. */
async function request<T>(message: VaultRequest): Promise<T> {
  try {
    const response = (await browser.runtime.sendMessage(message)) as
      VaultResponse | undefined;
    if (!response || response.ok !== true) throw new Error();
    return response.value as T;
  } catch {
    throw new Error('Session vault unavailable; nothing was sent');
  }
}

export async function put(
  placeholder: string,
  value: string,
  conversationId: string,
): Promise<void> {
  await putAll({ [placeholder]: value }, conversationId);
}

export async function putAll(
  entries: Readonly<Record<string, string>>,
  conversationId: string,
): Promise<void> {
  await request({
    type: 'apa:vault',
    op: 'putAll',
    entries: { ...entries },
    conversationId,
  });
}

export async function persistRedaction(
  text: string,
  entries: Readonly<Record<string, string>>,
  conversationId: string,
  retain = true,
): Promise<string> {
  return request({
    type: 'apa:vault',
    op: 'persist',
    text,
    entries: { ...entries },
    conversationId,
    retain,
  });
}

export async function resolve(
  placeholder: string,
  conversationId: string,
): Promise<string | null> {
  try {
    return await request({
      type: 'apa:vault',
      op: 'resolve',
      placeholder,
      conversationId,
    });
  } catch {
    return null;
  }
}

export async function purge(conversationId?: string): Promise<void> {
  await request({ type: 'apa:vault', op: 'purge', conversationId });
}

export async function size(): Promise<number> {
  try {
    return await request({ type: 'apa:vault', op: 'size' });
  } catch {
    return 0;
  }
}

export async function list(): Promise<VaultEntry[]> {
  try {
    return await request({ type: 'apa:vault', op: 'list' });
  } catch {
    return [];
  }
}

/** Serialize the options page's delete-all action with pending vault writes. */
export async function clearSession(): Promise<void> {
  await request({ type: 'apa:vault', op: 'clear' });
}
