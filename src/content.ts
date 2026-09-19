import type { ExtensionMessage } from './contracts';
import { findAdapter, findPageAdapter, setLearnedProfiles } from './providers';
import type { BrowserProviderProfile } from './mcplab/types';
import { ask } from './runtime/ask';
import {
  startProviderDiscovery,
  type ProviderDiscoverySession
} from './providers/provider-discovery';
import { replayProviderProfile } from './providers/discovery-replay';
import { roverResultMessage } from './content-result';

const runtime = globalThis as typeof globalThis & { __mcplabRoverInstalled?: boolean };
const activeAskControllers = new Map<string, AbortController>();
let debugObserver: MutationObserver | null = null;
let debugNotifyTimer: number | undefined;
let discoverySession: ProviderDiscoverySession | null = null;

function stopDebugObserver(): void {
  debugObserver?.disconnect();
  debugObserver = null;
  if (debugNotifyTimer !== undefined) window.clearTimeout(debugNotifyTimer);
  debugNotifyTimer = undefined;
}

function startDebugObserver(): void {
  stopDebugObserver();
  if (!document.body) return;
  debugObserver = new MutationObserver(() => {
    if (debugNotifyTimer !== undefined) window.clearTimeout(debugNotifyTimer);
    debugNotifyTimer = window.setTimeout(() => {
      debugNotifyTimer = undefined;
      void chrome.runtime.sendMessage({ type: 'ROVER_DEBUG_CHANGED' }).catch((error) => {
        console.warn('[Rover] debug update notification failed', error);
      });
    }, 250);
  });
  debugObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-label', 'class', 'data-is-streaming', 'disabled']
  });
}

function togglePanel(expand = false): boolean {
  const existing = document.querySelector<HTMLElement>('[data-mcplab-rover-panel]');
  if (existing) {
    const cleanup = panelCleanup.get(existing);
    cleanup?.();
    existing.remove();
    return false;
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
    :host { position: fixed; top: 20%; right: 12px; z-index: 2147483647; width: 42px; height: 42px; transform: translateY(-50%); overflow: visible; border-radius: 50%; background: transparent; box-shadow: none; transition: width .2s ease, height .2s ease, top .2s ease, right .2s ease, transform .2s ease; }
    :host(.expanded) { top: 12px; right: 12px; width: 390px; height: 300px; transform: none; overflow: visible; border-radius: 0; background: transparent; box-shadow: none; }
    button { position: absolute; top: 50%; left: 7px; z-index: 2; width: 34px; height: 34px; transform: translateY(-50%); display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: #191919; box-shadow: 0 0 0 4px rgba(255,255,255,.12), 0 8px 24px rgba(0,0,0,.35); cursor: pointer; }
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
    const expanding = !host.classList.contains('expanded');
    if (expanding) {
      host.style.left = '';
      host.style.top = '';
      host.style.right = '';
      host.style.transform = '';
    }
    host.classList.toggle('expanded');
    notch.title = host.classList.contains('expanded')
      ? 'Collapse MCPLab Rover'
      : 'Open MCPLab Rover';
    notch.setAttribute('aria-label', notch.title);
  });
  const onMessage = (event: MessageEvent) => {
    if (event.source === frame.contentWindow && event.data?.type === 'ROVER_CONNECTION_STATE') {
      notch.dataset.connected = String(event.data.connected === true);
    }
    if (event.source === frame.contentWindow && event.data?.type === 'ROVER_PANEL_SIZE') {
      const height = Number(event.data.height);
      if (Number.isFinite(height))
        host.style.height = `${Math.min(Math.max(height, 184), window.innerHeight - 24)}px`;
    }
  };
  window.addEventListener('message', onMessage);
  panelCleanup.set(host, () => window.removeEventListener('message', onMessage));
  shadow.append(style, notch, frame);
  document.documentElement.append(host);
  if (expand) {
    host.classList.add('expanded');
    notch.title = 'Collapse MCPLab Rover';
    notch.setAttribute('aria-label', notch.title);
  }
  return true;
}

function showPanel(): void {
  const existing = document.querySelector<HTMLElement>('[data-mcplab-rover-panel]');
  if (existing) {
    existing.classList.add('expanded');
    return;
  }
  togglePanel(true);
}

const panelCleanup = new WeakMap<HTMLElement, () => void>();

if (runtime.__mcplabRoverInstalled) {
  // The background worker may inject this file more than once for repeated runs.
} else {
  runtime.__mcplabRoverInstalled = true;
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    if ((message as { type?: string }).type === 'ROVER_SET_PROFILES') {
      setLearnedProfiles((message as { profiles?: BrowserProviderProfile[] }).profiles ?? []);
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'ROVER_LEARN_START') {
      discoverySession?.stop();
      discoverySession = startProviderDiscovery(
        (draft) => {
          void chrome.runtime.sendMessage({ type: 'ROVER_LEARN_RESULT', draft }).catch((error) => {
            console.warn('[Rover] provider discovery result delivery failed', error);
          });
        },
        (progress) => {
          void chrome.runtime
            .sendMessage({ type: 'ROVER_LEARN_PROGRESS', progress })
            .catch((error) => {
              console.warn('[Rover] provider discovery progress delivery failed', error);
            });
        }
      );
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'ROVER_LEARN_STOP') {
      discoverySession?.stop();
      discoverySession = null;
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'ROVER_LEARN_CAPTURE') {
      const captured = discoverySession?.capture() ?? false;
      sendResponse({
        ok: captured,
        ...(captured
          ? {}
          : { error: 'Nothing to capture yet: a composer and a response are both required.' })
      });
      return true;
    }
    if (message.type === 'ROVER_LEARN_VALIDATE') {
      sendResponse({
        ok: true,
        validation: replayProviderProfile(message.profile, message.trace)
      });
      return true;
    }
    if (message.type === 'ROVER_TOGGLE_PANEL') {
      sendResponse({ open: togglePanel() });
      return true;
    }
    if (message.type === 'ROVER_SHOW_PANEL') {
      showPanel();
      return;
    }
    if (message.type === 'ROVER_DETECT') {
      sendResponse(findAdapter()?.id ?? null);
      return true;
    }
    if (message.type === 'ROVER_DEBUG') {
      const pageAdapter = findPageAdapter();
      sendResponse({
        ok: true,
        provider: pageAdapter?.id,
        matched: Boolean(pageAdapter),
        elements: pageAdapter?.getDebugChecks() ?? []
      });
      return true;
    }
    if (message.type === 'ROVER_DEBUG_SUBSCRIBE') {
      if (message.enabled) startDebugObserver();
      else stopDebugObserver();
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'ROVER_NEW_CHAT') {
      void (async () => {
        const adapter = findAdapter();
        if (!adapter?.startNewConversation)
          throw new Error('New conversations are not supported on this page');
        await adapter.startNewConversation();
        sendResponse({ ok: true });
      })().catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
      return true;
    }
    if (message.type === 'ROVER_CANCEL_ASK') {
      const controller = activeAskControllers.get(message.requestId);
      console.info('[Rover debug] cancel ask received', {
        requestId: message.requestId,
        hasController: Boolean(controller)
      });
      controller?.abort();
      void Promise.resolve(findAdapter()?.stopGeneration?.())
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          console.warn('[Rover] provider generation cancellation failed', error);
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      return true;
    }
    if (message.type !== 'ROVER_ASK') return;
    void (async () => {
      if (activeAskControllers.size > 0) {
        await chrome.runtime.sendMessage({
          type: 'ROVER_RESULT',
          requestId: message.requestId,
          sessionId: message.sessionId,
          queueId: message.queueId,
          queueItemId: message.queueItemId,
          leaseId: message.leaseId,
          result: { ok: false, error: 'Another Rover execution is still active on this tab.' }
        });
        return;
      }
      const controller = new AbortController();
      activeAskControllers.set(message.requestId, controller);
      try {
        const adapter = findAdapter();
        if (!adapter) throw new Error('The active page is not a supported chat provider');
        const text = await ask(adapter, message.prompt, controller.signal);
        await chrome.runtime.sendMessage(roverResultMessage(message, { ok: true, text }));
      } catch (error) {
        const details = error as { message?: unknown; code?: unknown };
        await chrome.runtime.sendMessage(
          roverResultMessage(message, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            ...(typeof details.code === 'string' ? { code: details.code } : {})
          })
        );
      } finally {
        activeAskControllers.delete(message.requestId);
      }
    })();
  });

  let focusNotifyTimer: number | undefined;
  const notifyPageFocused = () => {
    if (focusNotifyTimer !== undefined) window.clearTimeout(focusNotifyTimer);
    focusNotifyTimer = window.setTimeout(() => {
      focusNotifyTimer = undefined;
      void chrome.runtime.sendMessage({ type: 'ROVER_PAGE_FOCUSED' }).catch(() => undefined);
    }, 250);
  };
  window.addEventListener('focus', notifyPageFocused);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') notifyPageFocused();
  });
}
