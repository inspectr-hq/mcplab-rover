import type { ExtensionMessage, ProviderId, RoverState } from './contracts';
import { DEFAULT_MCPLAB_ORIGIN, McplabClient, normalizeMcplabOrigin } from './mcplab/api-client';
import { acceptsContentResult } from './runtime/live-state';

const STATE_KEY = 'rover.run';
const ORIGIN_KEY = 'rover.mcplabOrigin';

chrome.action.onClicked.addListener(async (tab) => {
  if (typeof tab.id !== 'number') return;
  try {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'ROVER_TOGGLE_PANEL' });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'ROVER_TOGGLE_PANEL' });
    }
  } catch {
    // Chrome internal pages and restricted frames do not allow injection.
  }
});

async function getState(): Promise<RoverState | null> {
  return ((await chrome.storage.session.get(STATE_KEY))[STATE_KEY] as RoverState | undefined) ?? null;
}

async function saveState(state: RoverState): Promise<void> {
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

async function resolveOrigin(requested?: string): Promise<string> {
  const stored = (await chrome.storage.sync.get(ORIGIN_KEY))[ORIGIN_KEY];
  const origin = normalizeMcplabOrigin(requested ?? (typeof stored === 'string' ? stored : DEFAULT_MCPLAB_ORIGIN));
  await chrome.storage.sync.set({ [ORIGIN_KEY]: origin });
  return origin;
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
}

async function detectProvider(tabId: number): Promise<ProviderId | undefined> {
  try {
    try {
      return (await chrome.tabs.sendMessage(tabId, { type: 'ROVER_DETECT' })) ?? undefined;
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return (await chrome.tabs.sendMessage(tabId, { type: 'ROVER_DETECT' })) ?? undefined;
    }
  } catch {
    return undefined;
  }
}

async function complete(state: RoverState, text: string): Promise<RoverState> {
  const evaluating = { ...state, status: 'evaluating' as const, text };
  await saveState(evaluating);
  const completedAt = new Date().toISOString();
  const result = await new McplabClient(state.origin).complete(state.sessionId, {
    finalText: text,
    startedAt: state.startedAt,
    completedAt
  });
  const completed: RoverState = {
    ...evaluating,
    status: 'completed',
    completedAt,
    runId: result.runId,
    resultUrl: result.resultUrl,
    outcome: result.outcome,
    checkCounts: result.checkCounts
  };
  await saveState(completed);
  return completed;
}

async function fail(state: RoverState, error: unknown): Promise<void> {
  try {
    await new McplabClient(state.origin).cancel(state.sessionId);
  } catch {
    // Preserve the original browser or evaluation error.
  }
  await saveState({
    ...state,
    status: 'error',
    error: error instanceof Error ? error.message : String(error),
    completedAt: new Date().toISOString()
  });
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === 'ROVER_GET_STATE') {
    void getState().then(sendResponse);
    return true;
  }

  if (message.type === 'ROVER_GET_CATALOG') {
    void (async () => {
      const origin = await resolveOrigin(message.origin);
      sendResponse({ ok: true, origin, testCases: await new McplabClient(origin).listTestCases() });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === 'ROVER_PREPARE') {
    void (async () => {
      const origin = await resolveOrigin(message.origin);
      const tab = await activeTab();
      const provider = typeof tab?.id === 'number' ? await detectProvider(tab.id) : undefined;
      const session = await new McplabClient(origin).start(message.testCaseId, provider ?? 'manual');
      const state: RoverState = {
        requestId: crypto.randomUUID(),
        sessionId: session.id,
        testCaseId: session.testCaseId,
        testCaseName: session.testCaseName,
        prompt: session.prompt,
        origin,
        status: provider ? 'ready' : 'manual',
        tabId: tab?.id,
        provider,
        startedAt: new Date().toISOString()
      };
      await saveState(state);
      sendResponse({ ok: true, state });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === 'ROVER_EXECUTE') {
    void (async () => {
      const state = await getState();
      if (!state || state.status !== 'ready' || !state.provider || typeof state.tabId !== 'number') {
        throw new Error('No prepared Live Test is ready for browser execution.');
      }
      const running: RoverState = { ...state, status: 'running', startedAt: new Date().toISOString() };
      await saveState(running);
      try {
        await chrome.tabs.sendMessage(state.tabId, {
          type: 'ROVER_ASK',
          requestId: state.requestId,
          sessionId: state.sessionId,
          prompt: state.prompt
        });
        sendResponse({ ok: true, state: running });
      } catch (error) {
        await fail(running, error);
        throw error;
      }
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === 'ROVER_COMPLETE_MANUAL') {
    void (async () => {
      const state = await getState();
      if (!state || state.status !== 'manual') throw new Error('No manual Live Test is ready.');
      try {
        sendResponse({ ok: true, state: await complete(state, message.text) });
      } catch (error) {
        await fail(state, error);
        throw error;
      }
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === 'ROVER_CANCEL') {
    void (async () => {
      const state = await getState();
      if (state && state.status !== 'completed') {
        await new McplabClient(state.origin).cancel(state.sessionId).catch(() => undefined);
      }
      await chrome.storage.session.remove(STATE_KEY);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'ROVER_RESULT') {
    void (async () => {
      const state = await getState();
      if (!state || !acceptsContentResult(state, message)) return;
      try {
        if (!message.result.ok) throw new Error(message.result.error);
        await complete(state, message.result.text);
      } catch (error) {
        await fail(state, error);
      }
    })();
  }
});
