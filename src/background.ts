import type { ExtensionMessage, ProviderId, RoverState } from './contracts';
import { DEFAULT_MCPLAB_ORIGIN, McplabClient, normalizeMcplabOrigin } from './mcplab/api-client';
import { acceptsContentResult } from './runtime/live-state';
import {
  addQueueItem,
  createQueue,
  moveQueueItem,
  recordQueueItemOutcome,
  removeQueueItem,
  skipQueueItem,
  startQueue,
  stopQueue,
  type RoverQueueState
} from './queue/state';

const STATE_KEY = 'rover.run';
const ORIGIN_KEY = 'rover.mcplabOrigin';
const QUEUE_KEY = 'rover.queue';
let roverSocket: WebSocket | null = null;

async function connectToMcplab(): Promise<void> {
  const origin = await resolveOrigin();
  if (roverSocket && (roverSocket.readyState === WebSocket.OPEN || roverSocket.readyState === WebSocket.CONNECTING)) return;
  const wsOrigin = origin.replace(/^http/i, 'ws');
  const socket = new WebSocket(`${wsOrigin}/api/rover/ws`);
  roverSocket = socket;
  socket.onopen = async () => {
    const tab = await activeTab();
    const provider = typeof tab?.id === 'number' ? await detectProvider(tab.id) : undefined;
    if (!provider) return;
    socket.send(JSON.stringify({ type: 'register', protocolVersion: 1, provider, pageUrl: tab?.url ?? '', extensionVersion: chrome.runtime.getManifest().version }));
  };
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as { type?: string; jobId?: string; agent?: { provider?: ProviderId }; scenarios?: Array<{ id: string; name?: string; prompt: string; eval?: unknown }>; newConversationBetweenScenarios?: boolean };
      if (message.type !== 'assignment' || !message.jobId || !message.agent?.provider || !message.scenarios?.length) return;
      void (async () => {
        const tab = await activeTab();
        if (typeof tab?.id !== 'number') return;
        const queue = createQueue(origin, message.agent!.provider!, message.newConversationBetweenScenarios !== false, new Date().toISOString());
        const assigned = { ...queue, queueId: message.jobId!, tabId: tab.id, items: message.scenarios!.map((scenario) => ({ queueItemId: crypto.randomUUID(), testCaseId: scenario.id, id: scenario.id, name: scenario.name ?? scenario.id, prompt: scenario.prompt, assertionCount: 0, status: 'queued' as const })) };
        await saveQueue(assigned);
        const started = startQueue(assigned, new Date().toISOString());
        await saveQueue(started);
        await runQueueItem(started);
      })();
    } catch { /* ignore malformed server messages */ }
  };
  socket.onclose = () => { if (roverSocket === socket) roverSocket = null; };
}

void connectToMcplab().catch(() => undefined);

chrome.action.onClicked.addListener(async (tab) => {
  if (typeof tab.id !== 'number') return;
  try {
    await connectToMcplab().catch(() => undefined);
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

async function getQueue(): Promise<RoverQueueState | null> {
  return ((await chrome.storage.session.get(QUEUE_KEY))[QUEUE_KEY] as RoverQueueState | undefined) ?? null;
}

async function saveQueue(queue: RoverQueueState): Promise<void> {
  await chrome.storage.session.set({ [QUEUE_KEY]: queue });
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

async function pauseQueue(queue: RoverQueueState, error: unknown, stage: 'browser' | 'mcplab' = 'browser'): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const paused: RoverQueueState = {
    ...queue,
    status: 'paused',
    error: { stage, message },
    items: queue.items.map((item) => item.queueItemId === queue.activeItemId ? { ...item, status: 'error' as const } : item),
    updatedAt: new Date().toISOString()
  };
  await saveQueue(paused);
}

async function runQueueItem(queue: RoverQueueState): Promise<void> {
  const item = queue.items.find((candidate) => candidate.queueItemId === queue.activeItemId);
  if (!item || typeof queue.tabId !== 'number') return;
  try {
    const client = new McplabClient(queue.origin);
    const session = item.sessionId ? await client.get(item.sessionId) : await client.start(item.testCaseId, queue.provider);
    const prompt = item.prompt || session.prompt;
    const requestId = crypto.randomUUID();
    const running: RoverQueueState = {
      ...queue,
      items: queue.items.map((candidate) => candidate.queueItemId === item.queueItemId
        ? { ...candidate, prompt, sessionId: session.id, requestId, status: 'running' as const, startedAt: new Date().toISOString() }
        : candidate),
      updatedAt: new Date().toISOString()
    };
    await saveQueue(running);
    await chrome.tabs.sendMessage(queue.tabId, {
      type: 'ROVER_ASK',
      requestId,
      sessionId: session.id,
      queueId: queue.queueId,
      queueItemId: item.queueItemId,
      prompt
    });
  } catch (error) {
    await pauseQueue(queue, error);
  }
}

async function waitForTabComplete(tabId: number): Promise<void> {
  const current = await chrome.tabs.get(tabId);
  if (current.status === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('New conversation did not finish loading.'));
    }, 30_000);
    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function startQueueConversation(queue: RoverQueueState): Promise<void> {
  if (typeof queue.tabId !== 'number') throw new Error('Queue browser tab is unavailable.');
  if (queue.provider === 'trendminer') {
    const response = await chrome.tabs.sendMessage(queue.tabId, { type: 'ROVER_NEW_CHAT', requestId: crypto.randomUUID(), queueId: queue.queueId });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not start a new TrendMiner conversation.');
    return;
  }
  await chrome.tabs.update(queue.tabId, { url: 'https://claude.ai/new' });
  await waitForTabComplete(queue.tabId);
  if (!(await detectProvider(queue.tabId))) throw new Error('Claude composer is not ready after starting a new conversation.');
  await chrome.tabs.sendMessage(queue.tabId, { type: 'ROVER_SHOW_PANEL' });
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

  if (message.type === 'ROVER_QUEUE_GET') {
    void getQueue().then(sendResponse);
    return true;
  }

  if (message.type === 'ROVER_QUEUE_CREATE') {
    void (async () => {
      const origin = await resolveOrigin(message.origin);
      const tab = await activeTab();
      const provider = typeof tab?.id === 'number' ? await detectProvider(tab.id) : undefined;
      if (!provider || typeof tab?.id !== 'number') throw new Error('Queue mode requires a supported Claude or TrendMiner page.');
      const queue = createQueue(origin, provider, message.newConversationBetweenItems, new Date().toISOString());
      await saveQueue({ ...queue, tabId: tab.id });
      sendResponse({ ok: true, queue: { ...queue, tabId: tab.id } });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === 'ROVER_QUEUE_SET_NEW_CHAT') {
    void (async () => {
      const queue = await getQueue();
      if (!queue || queue.status !== 'draft') throw new Error('Conversation setting can only change before the queue starts.');
      const next = { ...queue, newConversationBetweenItems: message.enabled, updatedAt: new Date().toISOString() };
      await saveQueue(next);
      sendResponse({ ok: true, queue: next });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === 'ROVER_QUEUE_ADD' || message.type === 'ROVER_QUEUE_REMOVE' || message.type === 'ROVER_QUEUE_MOVE') {
    void (async () => {
      const queue = await getQueue();
      if (!queue) throw new Error('No queue has been created.');
      const next = message.type === 'ROVER_QUEUE_ADD'
        ? addQueueItem(queue, message.item)
        : message.type === 'ROVER_QUEUE_REMOVE'
          ? removeQueueItem(queue, message.queueItemId)
          : moveQueueItem(queue, message.queueItemId, message.direction);
      await saveQueue(next);
      sendResponse({ ok: true, queue: next });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === 'ROVER_QUEUE_START') {
    void (async () => {
      const queue = await getQueue();
      if (!queue) throw new Error('No queue has been created.');
      const started = startQueue(queue, new Date().toISOString());
      await saveQueue(started);
      sendResponse({ ok: true, queue: started });
      await runQueueItem(started);
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === 'ROVER_QUEUE_STOP' || message.type === 'ROVER_QUEUE_SKIP') {
    void (async () => {
      const queue = await getQueue();
      if (!queue) throw new Error('No queue is active.');
      const item = queue.items.find((candidate) => candidate.queueItemId === queue.activeItemId);
      if (item?.sessionId) await new McplabClient(queue.origin).cancel(item.sessionId).catch(() => undefined);
      const next = message.type === 'ROVER_QUEUE_STOP'
        ? stopQueue(queue, new Date().toISOString())
        : skipQueueItem(queue, queue.activeItemId!, new Date().toISOString());
      await saveQueue(next);
      sendResponse({ ok: true, queue: next });
      if (message.type === 'ROVER_QUEUE_SKIP' && next.status === 'running') await runQueueItem(next);
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === 'ROVER_QUEUE_RETRY') {
    void (async () => {
      const queue = await getQueue();
      if (!queue || queue.status !== 'paused' || !queue.activeItemId) throw new Error('No paused queue item to retry.');
      const retrying: RoverQueueState = { ...queue, status: 'running', error: undefined, items: queue.items.map((item) => item.queueItemId === queue.activeItemId ? { ...item, status: 'running' as const } : item), updatedAt: new Date().toISOString() };
      await saveQueue(retrying);
      sendResponse({ ok: true, queue: retrying });
      await runQueueItem(retrying);
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
      if (message.queueId && message.queueItemId) {
        const queue = await getQueue();
        const item = queue?.items.find((candidate) => candidate.queueItemId === message.queueItemId);
        if (!queue || queue.queueId !== message.queueId || queue.activeItemId !== message.queueItemId || item?.requestId !== message.requestId || item.sessionId !== message.sessionId) return;
        if (!message.result.ok) {
          await pauseQueue(queue, new Error(message.result.error));
          return;
        }
        const finalText = message.result.text;
        const evaluating: RoverQueueState = { ...queue, items: queue.items.map((candidate) => candidate.queueItemId === item.queueItemId ? { ...candidate, status: 'evaluating' as const, text: finalText } : candidate), updatedAt: new Date().toISOString() };
        await saveQueue(evaluating);
        try {
          const result = await new McplabClient(queue.origin).complete(item.sessionId, { finalText, startedAt: item.startedAt ?? new Date().toISOString(), completedAt: new Date().toISOString() });
          const completed = recordQueueItemOutcome(evaluating, item.queueItemId, result.outcome, { runId: result.runId, resultUrl: result.resultUrl, checkCounts: result.checkCounts, text: finalText }, new Date().toISOString());
          await saveQueue(completed);
          if (completed.status === 'completed' && roverSocket?.readyState === WebSocket.OPEN) {
            roverSocket.send(JSON.stringify({ type: 'complete', jobId: queue.queueId, runId: result.runId, outcome: result.outcome }));
          }
          if (completed.status === 'running') {
            try {
              if (completed.newConversationBetweenItems) await startQueueConversation(completed);
              await runQueueItem(completed);
            } catch (error) {
              await pauseQueue(completed, error);
            }
          }
        } catch (error) {
          await pauseQueue(evaluating, error, 'mcplab');
        }
        return;
      }
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
