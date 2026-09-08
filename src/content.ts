import type { ExtensionMessage } from './contracts';
import { findAdapter } from './providers';
import { ask } from './runtime/ask';

const runtime = globalThis as typeof globalThis & { __mcplabRoverInstalled?: boolean };

function togglePanel(): void {
  const existing = document.querySelector<HTMLElement>('[data-mcplab-rover-panel]');
  if (existing) {
    existing.remove();
    return;
  }
  const host = document.createElement('div');
  host.dataset.mcplabRoverPanel = 'true';
  const shadow = host.attachShadow({ mode: 'closed' });
  const frame = document.createElement('iframe');
  frame.title = 'MCPLab Rover';
  frame.src = chrome.runtime.getURL('rover.html');
  frame.style.cssText = [
    'position: fixed',
    'top: 12px',
    'right: 12px',
    'width: 390px',
    'height: min(720px, calc(100vh - 24px))',
    'border: 0',
    'border-radius: 20px',
    'z-index: 2147483647',
    'background: transparent',
    'box-shadow: 0 16px 48px rgba(0, 0, 0, .24)'
  ].join(';');
  shadow.append(frame);
  document.documentElement.append(host);
}

if (runtime.__mcplabRoverInstalled) {
  // The background worker may inject this file more than once for repeated runs.
} else {
  runtime.__mcplabRoverInstalled = true;
  chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
    if (message.type === 'ROVER_TOGGLE_PANEL') {
      togglePanel();
      return;
    }
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
