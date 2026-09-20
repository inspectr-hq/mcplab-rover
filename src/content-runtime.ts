import type { ExtensionMessage } from './contracts';

function isInvalidatedContextError(error: unknown): boolean {
  return error instanceof Error && /Extension context invalidated/i.test(error.message);
}

export function createSafeRuntimeMessageSender<TMessage, TResponse>(
  sendMessage: (message: TMessage) => TResponse | PromiseLike<TResponse>
): (message: TMessage) => Promise<TResponse | undefined> {
  let invalidated = false;
  return async (message) => {
    if (invalidated) return undefined;
    try {
      return await sendMessage(message);
    } catch (error) {
      if (!isInvalidatedContextError(error)) throw error;
      invalidated = true;
      return undefined;
    }
  };
}

export const sendRuntimeMessage = createSafeRuntimeMessageSender<ExtensionMessage, unknown>(
  (message) => chrome.runtime.sendMessage(message)
);
