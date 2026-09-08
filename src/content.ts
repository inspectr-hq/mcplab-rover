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
  const notch = document.createElement('button');
  notch.type = 'button';
  notch.title = 'Open MCPLab Rover';
  notch.setAttribute('aria-label', 'Open MCPLab Rover');
  notch.innerHTML = `<img src="${chrome.runtime.getURL('icons/mcplab-favicon.svg')}" alt=""><span></span>`;
  const style = document.createElement('style');
  style.textContent = `
    :host { position: fixed; top: 50%; right: 0; z-index: 2147483647; width: 52px; height: 112px; transform: translateY(-50%); overflow: hidden; border-radius: 28px 0 0 28px; background: #080808; box-shadow: 0 10px 30px rgba(0,0,0,.32); transition: width .2s ease, height .2s ease, top .2s ease, right .2s ease, transform .2s ease; }
    :host(.expanded) { top: 12px; right: 12px; width: 390px; height: 300px; transform: none; overflow: visible; border-radius: 0; background: transparent; box-shadow: none; }
    button { position: absolute; top: 50%; left: 9px; z-index: 2; width: 34px; height: 34px; transform: translateY(-50%); display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: #191919; box-shadow: 0 0 0 4px rgba(255,255,255,.12), 0 8px 24px rgba(0,0,0,.35); cursor: pointer; }
    button img { width: 20px; height: 20px; }
    button span { position: absolute; right: 1px; top: 1px; width: 8px; height: 8px; border-radius: 50%; background: #77736e; box-shadow: 0 0 0 2px #101010; }
    button[data-connected="true"] span { background: #42d392; box-shadow: 0 0 8px rgba(66,211,146,.8), 0 0 0 2px #101010; animation: pulse 1.8s ease-in-out infinite; }
    iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: 20px 8px 20px 20px; background: transparent; box-shadow: 0 16px 48px rgba(0,0,0,.24); opacity: 0; pointer-events: none; transition: opacity .15s ease; }
    :host(.expanded) button { top: 18px; left: auto; right: 8px; width: 24px; height: 24px; background: rgba(0,0,0,.35); box-shadow: none; }
    :host(.expanded) button img { display: none; }
    :host(.expanded) button span { display: none; }
    :host(.expanded) button::before { content: '›'; color: white; font: 22px/1 system-ui; transform: rotate(180deg); }
    :host(.expanded) iframe { opacity: 1; pointer-events: auto; }
    @keyframes pulse { 0%,100% { transform: scale(.85); opacity: .55; } 50% { transform: scale(1); opacity: 1; } }
  `;
  const frame = document.createElement('iframe');
  frame.title = 'MCPLab Rover';
  frame.src = chrome.runtime.getURL('rover.html');
  notch.addEventListener('click', () => {
    host.classList.toggle('expanded');
    notch.title = host.classList.contains('expanded') ? 'Collapse MCPLab Rover' : 'Open MCPLab Rover';
    notch.setAttribute('aria-label', notch.title);
  });
  window.addEventListener('message', (event) => {
    if (event.source === frame.contentWindow && event.data?.type === 'ROVER_CONNECTION_STATE') {
      notch.dataset.connected = String(event.data.connected === true);
    }
    if (event.source === frame.contentWindow && event.data?.type === 'ROVER_PANEL_SIZE') {
      const height = Number(event.data.height);
      if (Number.isFinite(height)) host.style.height = `${Math.min(Math.max(height, 184), window.innerHeight - 24)}px`;
    }
  });
  shadow.append(style, notch, frame);
  document.documentElement.append(host);
}

if (runtime.__mcplabRoverInstalled) {
  // The background worker may inject this file more than once for repeated runs.
} else {
  runtime.__mcplabRoverInstalled = true;
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === 'ROVER_TOGGLE_PANEL') {
      togglePanel();
      return;
    }
    if (message.type === 'ROVER_DETECT') {
      sendResponse(findAdapter()?.id ?? null);
      return true;
    }
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
