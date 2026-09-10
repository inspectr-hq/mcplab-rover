import type { DebugElementCheck, ExtensionMessage, ProviderId, RoverStage, RoverState } from '../contracts';
import { McplabClient } from '../mcplab/api-client';
import { acceptsContentResult } from '../runtime/live-state';
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
} from '../queue/state';
import { activeTab, detectProvider, expectedProviderForUrl } from './browser';
import { createDebugSnapshot } from './debug';
import { errorMessage } from './errors';
import { complete, fail } from './live-test';
import { cancelActiveQueueItem, pauseQueue, runQueueItem, startQueueConversation } from './queue-runner';
import { currentSocket } from './socket';
import { getQueue, getState, QUEUE_KEY, resolveOrigin, saveQueue, saveState, STATE_KEY } from './store';

function respond<T>(sendResponse: (response: T | { ok: false; error: string }) => void, work: () => Promise<T>): true {
  void work().then(sendResponse).catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
}

export function installMessageHandler(): void {
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === 'ROVER_GET_STATE') {
      void getState().then(sendResponse);
      return true;
    }

    if (message.type === 'ROVER_GET_CATALOG') {
      return respond(sendResponse, async () => {
        const origin = await resolveOrigin(message.origin);
        return { ok: true, origin, testCases: await new McplabClient(origin).listTestCases() };
      });
    }

    if (message.type === 'ROVER_GET_DEBUG') {
      return respond(sendResponse, async () => {
        const origin = await resolveOrigin(message.origin);
        const [manual, queue, tab] = await Promise.all([getState(), getQueue(), activeTab()]);
        let endpointConnected = false;
        let endpointError: string | undefined;
        try {
          await new McplabClient(origin).listTestCases();
          endpointConnected = true;
        } catch (error) {
          endpointError = errorMessage(error);
        }

        let page: { matched: boolean; provider?: ProviderId; elements: DebugElementCheck[]; error?: string } | undefined;
        if (typeof tab?.id === 'number') {
          try {
            await detectProvider(tab.id);
            const response = await chrome.tabs.sendMessage(tab.id, { type: 'ROVER_DEBUG' });
            page = {
              matched: response?.matched === true,
              provider: response?.provider,
              elements: response?.elements ?? []
            };
          } catch (error) {
            page = { matched: Boolean(expectedProviderForUrl(tab.url)), provider: expectedProviderForUrl(tab.url), elements: [], error: errorMessage(error) };
          }
        } else {
          page = { matched: false, elements: [], error: 'No active browser tab.' };
        }

        return createDebugSnapshot({
          checkedAt: new Date().toISOString(),
          origin,
          endpointConnected,
          endpointError,
          tab,
          page,
          manual,
          queue
        });
      });
    }

    if (message.type === 'ROVER_QUEUE_GET') {
      void getQueue().then(sendResponse);
      return true;
    }

    if (message.type === 'ROVER_QUEUE_CLEAR') {
      return respond(sendResponse, async () => {
        const queue = await getQueue();
        if (queue) await cancelActiveQueueItem(queue);
        await chrome.storage.session.remove(QUEUE_KEY);
        return { ok: true };
      });
    }

    if (message.type === 'ROVER_QUEUE_CREATE') {
      return respond(sendResponse, async () => {
        const origin = await resolveOrigin(message.origin);
        const tab = await activeTab();
        const provider = typeof tab?.id === 'number' ? await detectProvider(tab.id) : undefined;
        if (!provider || typeof tab?.id !== 'number') throw new Error('Queue mode requires a supported Claude or TrendMiner page.');
        const queue = { ...createQueueForMessage(origin, provider, message.newConversationBetweenItems), tabId: tab.id };
        await saveQueue(queue);
        await chrome.storage.session.remove(STATE_KEY);
        return { ok: true, queue };
      });
    }

    if (message.type === 'ROVER_QUEUE_SET_NEW_CHAT') {
      return respond(sendResponse, async () => {
        const queue = await getQueue();
        if (!queue || queue.status !== 'draft') throw new Error('Conversation setting can only change before the queue starts.');
        const next = { ...queue, newConversationBetweenItems: message.enabled, updatedAt: new Date().toISOString() };
        await saveQueue(next);
        return { ok: true, queue: next };
      });
    }

    if (message.type === 'ROVER_QUEUE_ADD' || message.type === 'ROVER_QUEUE_REMOVE' || message.type === 'ROVER_QUEUE_MOVE') {
      return respond(sendResponse, async () => {
        const queue = await getQueue();
        if (!queue) throw new Error('No queue has been created.');
        const next = message.type === 'ROVER_QUEUE_ADD'
          ? addQueueItem(queue, message.item)
          : message.type === 'ROVER_QUEUE_REMOVE'
            ? removeQueueItem(queue, message.queueItemId)
            : moveQueueItem(queue, message.queueItemId, message.direction);
        await saveQueue(next);
        return { ok: true, queue: next };
      });
    }

    if (message.type === 'ROVER_QUEUE_START') {
      void (async () => {
        const queue = await getQueue();
        if (!queue) throw new Error('No queue has been created.');
        const started = startQueue(queue, new Date().toISOString());
        await saveQueue(started);
        sendResponse({ ok: true, queue: started });
        await runQueueItem(started);
      })().catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
      return true;
    }

    if (message.type === 'ROVER_QUEUE_STOP' || message.type === 'ROVER_QUEUE_SKIP') {
      void (async () => {
        const queue = await getQueue();
        if (!queue) throw new Error('No queue is active.');
        await cancelActiveQueueItem(queue);
        const next = message.type === 'ROVER_QUEUE_STOP'
          ? stopQueue(queue, new Date().toISOString())
          : skipQueueItem(queue, queue.activeItemId!, new Date().toISOString());
        await saveQueue(next);
        sendResponse({ ok: true, queue: next });
        if (message.type === 'ROVER_QUEUE_SKIP' && next.status === 'running') await runQueueItem(next);
      })().catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
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
      })().catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
      return true;
    }

    if (message.type === 'ROVER_PREPARE') {
      return respond(sendResponse, async () => {
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
        await chrome.storage.session.remove(QUEUE_KEY);
        await saveState(state);
        return { ok: true, state };
      });
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
          await chrome.tabs.sendMessage(state.tabId, { type: 'ROVER_ASK', requestId: state.requestId, sessionId: state.sessionId, prompt: state.prompt });
          sendResponse({ ok: true, state: running });
        } catch (error) {
          await fail(running, error);
          throw error;
        }
      })().catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
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
      })().catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
      return true;
    }

    if (message.type === 'ROVER_CANCEL') {
      return respond(sendResponse, async () => {
        const state = await getState();
        if (state && state.status !== 'completed') await new McplabClient(state.origin).cancel(state.sessionId).catch(() => undefined);
        await chrome.storage.session.remove(STATE_KEY);
        return { ok: true };
      });
    }

    if (message.type === 'ROVER_RESULT') {
      void handleResult(message);
    }
  });
}

function createQueueForMessage(origin: string, provider: RoverQueueState['provider'], newConversationBetweenItems: boolean): RoverQueueState {
  return createQueue(origin, provider, newConversationBetweenItems, new Date().toISOString());
}

function sendQueueStage(queue: RoverQueueState, scenarioId: string, stage: RoverStage): void {
  const socket = currentSocket();
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'stage', jobId: queue.queueId, scenarioId, stage }));
  }
}

async function handleResult(message: Extract<ExtensionMessage, { type: 'ROVER_RESULT' }>): Promise<void> {
  if (message.queueId && message.queueItemId) {
    const queue = await getQueue();
    const item = queue?.items.find((candidate) => candidate.queueItemId === message.queueItemId);
    if (!queue || queue.queueId !== message.queueId || queue.activeItemId !== message.queueItemId || item?.requestId !== message.requestId || item.sessionId !== message.sessionId) return;
    if (!message.result.ok) {
      await pauseQueue(queue, new Error(message.result.error));
      return;
    }
    const finalText = message.result.text;
    sendQueueStage(queue, item.testCaseId, 'response_captured');
    const evaluating: RoverQueueState = { ...queue, items: queue.items.map((candidate) => candidate.queueItemId === item.queueItemId ? { ...candidate, status: 'evaluating' as const, text: finalText } : candidate), updatedAt: new Date().toISOString() };
    await saveQueue(evaluating);
    try {
      sendQueueStage(queue, item.testCaseId, 'evaluating');
      const result = await new McplabClient(queue.origin).complete(item.sessionId, { finalText, startedAt: item.startedAt ?? new Date().toISOString(), completedAt: new Date().toISOString() });
      const resultUrl = queue.evaluationRunId
        ? `/results/${encodeURIComponent(queue.evaluationRunId)}`
        : result.resultUrl;
      const completed = recordQueueItemOutcome(evaluating, item.queueItemId, result.outcome, { runId: result.runId, resultUrl, checkCounts: result.checkCounts, text: finalText }, new Date().toISOString());
      await saveQueue(completed);
      sendQueueStage(queue, item.testCaseId, 'persisted');
      const socket = currentSocket();
      if (socket?.readyState === WebSocket.OPEN) {
        const durationMs = item.startedAt ? Math.max(0, Date.parse(new Date().toISOString()) - Date.parse(item.startedAt)) : undefined;
        socket.send(JSON.stringify({ type: 'progress', jobId: queue.queueId, completed: completed.items.filter((candidate) => ['passed', 'failed', 'incomplete', 'skipped'].includes(candidate.status)).length, total: completed.items.length, currentScenarioId: completed.activeItemId ? completed.items.find((candidate) => candidate.queueItemId === completed.activeItemId)?.testCaseId : undefined, lastDurationMs: durationMs, ...(result.outcome === 'failed' || result.outcome === 'error' ? { error: result.outcome } : {}) }));
        if (completed.status === 'completed') socket.send(JSON.stringify({ type: 'complete', jobId: queue.queueId, runId: result.runId, outcome: result.outcome }));
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
}
