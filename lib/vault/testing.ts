import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleVaultRequest } from './service';

/** The fake browser does not dispatch runtime messages to background listeners. */
export function connectVaultForTests(): void {
  fakeBrowser.runtime.sendMessage = (async (message: unknown) =>
    handleVaultRequest(message)) as typeof fakeBrowser.runtime.sendMessage;
}
