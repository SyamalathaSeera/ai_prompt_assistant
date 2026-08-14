import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  dispatchRefineToActiveTab,
  isRefineMessage,
  REFINE_COMMAND,
  REFINE_MESSAGE,
} from './messaging';

let query: ReturnType<typeof vi.fn>;
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeBrowser.reset();

  // fakeBrowser implements storage in full but not tab messaging, so these two
  // are stood in for directly.
  query = vi.fn().mockResolvedValue([{ id: 7 }]);
  sendMessage = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation(query as never);
  vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation(sendMessage as never);
});

describe('isRefineMessage', () => {
  it('accepts our message', () => {
    expect(isRefineMessage(REFINE_MESSAGE)).toBe(true);
  });

  it('rejects anything else', () => {
    // The content script also receives messages from our own popup and options
    // page, and the shape is whatever the sender chose to send.
    for (const value of [null, undefined, 'apa:refine', 42, {}, { type: 'other' }, []]) {
      expect(isRefineMessage(value)).toBe(false);
    }
  });
});

describe('dispatchRefineToActiveTab', () => {
  it('sends to the tab the user is looking at', async () => {
    await dispatchRefineToActiveTab();

    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(sendMessage).toHaveBeenCalledWith(7, REFINE_MESSAGE);
  });

  it('carries no prompt text', async () => {
    // The content script reads the composer itself. Routing the draft through
    // the background worker would put it somewhere it has no reason to be.
    await dispatchRefineToActiveTab();

    expect(JSON.stringify(sendMessage.mock.calls[0]![1])).toBe('{"type":"apa:refine"}');
  });

  it('stays quiet when the tab has no content script', async () => {
    // The shortcut is global, so it fires on any tab. Pressing it on a news
    // site must do nothing at all.
    sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));

    await expect(dispatchRefineToActiveTab()).resolves.toBeUndefined();
  });

  it('stays quiet when there is no active tab', async () => {
    query.mockResolvedValue([]);

    await dispatchRefineToActiveTab();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('stays quiet when the query itself fails', async () => {
    query.mockRejectedValue(new Error('no permission'));

    await expect(dispatchRefineToActiveTab()).resolves.toBeUndefined();
  });
});

/**
 * Reads the built manifest. Absent on a fresh checkout, so these skip rather
 * than fail — same convention as test/manifest.test.ts.
 */
const manifest = (() => {
  try {
    return JSON.parse(
      readFileSync(resolve(__dirname, '../.output/chrome-mv3/manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
})();

describe.skipIf(manifest === null)('the shortcut', () => {
  it('is declared under the name the worker listens for', () => {
    // Drift here means the shortcut silently does nothing: Chrome delivers a
    // command name the background worker does not recognise.
    const commands = (manifest!.commands ?? {}) as Record<string, unknown>;
    expect(Object.keys(commands)).toContain(REFINE_COMMAND);
  });

  it('does not take a binding the browser or the host pages already use', () => {
    // Ctrl+Shift+I is devtools, and the host pages have claimed most of what
    // is left in that space.
    const commands = manifest!.commands as Record<
      string,
      { suggested_key?: { default?: string } }
    >;
    const key = commands[REFINE_COMMAND]?.suggested_key?.default ?? '';

    expect(key).not.toMatch(/Ctrl\+Shift\+[IJC]/);
    expect(key).toContain('Alt');
  });
});
