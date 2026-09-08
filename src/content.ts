import type { ExtensionMessage } from './contracts';
import { findAdapter } from './providers';
import { ask } from './runtime/ask';

const runtime = globalThis as typeof globalThis & { __mcplabRoverInstalled?: boolean };
if (runtime.__mcplabRoverInstalled) {
  // The background worker may inject this file more than once for repeated runs.
} else {
  runtime.__mcplabRoverInstalled = true;
  chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
    if (message.type === 'ROVER_DETECT') return findAdapter()?.id ?? null;
    if (message.type !== 'ROVER_ASK') return;
    void (async () => {
      try {
        const adapter = findAdapter();
        if (!adapter) throw new Error('The active page is not a supported chat provider');
        const text = await ask(adapter, message.prompt);
        await chrome.runtime.sendMessage({
          type: 'ROVER_RESULT',
          requestId: message.requestId,
          sessionId: message.sessionId,
          result: { ok: true, text }
        });
      } catch (error) {
        await chrome.runtime.sendMessage({
          type: 'ROVER_RESULT',
          requestId: message.requestId,
          sessionId: message.sessionId,
          result: { ok: false, error: error instanceof Error ? error.message : String(error) }
        });
      }
    })();
  });
}
