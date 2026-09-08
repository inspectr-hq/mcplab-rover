import { SMOKE_PROMPT, type ExtensionMessage, type RunState } from './contracts';

const STATE_KEY = 'rover.run';

async function saveState(state: RunState): Promise<void> {
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === 'ROVER_GET_STATE') {
    void chrome.storage.session.get(STATE_KEY).then((value) => sendResponse(value[STATE_KEY] ?? null));
    return true;
  }

  if (message.type === 'ROVER_START') {
    void (async () => {
      const tabId = message.tabId ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
      if (typeof tabId !== 'number') throw new Error('No active browser tab was found');
      const current = (await chrome.storage.session.get(STATE_KEY))[STATE_KEY] as RunState | undefined;
      if (current?.status === 'running' && current.tabId === tabId) throw new Error('A Rover run is already active in this tab');
      const requestId = crypto.randomUUID();
      const state: RunState = { requestId, tabId, status: 'running', startedAt: new Date().toISOString() };
      await saveState(state);
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, { type: 'ROVER_ASK', requestId, prompt: message.prompt || SMOKE_PROMPT });
      sendResponse({ ok: true, state });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === 'ROVER_RESULT') {
    void (async () => {
      const current = (await chrome.storage.session.get(STATE_KEY))[STATE_KEY] as RunState | undefined;
      if (!current || current.requestId !== message.requestId) return;
      const completedAt = new Date().toISOString();
      await saveState(
        message.result.ok
          ? { ...current, status: 'completed', text: message.result.text, completedAt }
          : { ...current, status: 'error', error: message.result.error, completedAt }
      );
    })();
  }
});
