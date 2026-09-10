import { McplabClient } from '../mcplab/api-client';
import {
  type RoverQueueState
} from '../queue/state';
import { detectProvider } from './browser';
import type { RoverStage } from '../contracts';
import { errorMessage } from './errors';
import { saveQueue } from './store';
import { currentSocket } from './socket';

function sendStage(queue: RoverQueueState, itemId: string, stage: RoverStage): void {
  const socket = currentSocket();
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'stage', jobId: queue.queueId, scenarioId: itemId, stage }));
  }
}

export async function cancelActiveQueueItem(queue: RoverQueueState): Promise<void> {
  const item = queue.activeItemId ? queue.items.find((candidate) => candidate.queueItemId === queue.activeItemId) : undefined;
  if (item?.sessionId) await new McplabClient(queue.origin).cancel(item.sessionId).catch(() => undefined);
}

export async function pauseQueue(queue: RoverQueueState, error: unknown, stage: 'browser' | 'mcplab' = 'browser'): Promise<void> {
  const paused: RoverQueueState = {
    ...queue,
    status: 'paused',
    error: { stage, message: errorMessage(error) },
    items: queue.items.map((item) => item.queueItemId === queue.activeItemId ? { ...item, status: 'error' as const } : item),
    updatedAt: new Date().toISOString()
  };
  await saveQueue(paused);
}

export async function runQueueItem(queue: RoverQueueState): Promise<void> {
  const item = queue.items.find((candidate) => candidate.queueItemId === queue.activeItemId);
  if (!item || typeof queue.tabId !== 'number') return;
  try {
    const client = new McplabClient(queue.origin);
    if (queue.provider !== 'claude' && queue.provider !== 'trendminer') {
      const profile = (await client.listBrowserProviders()).find((candidate) => candidate.id === queue.provider);
      if (!profile) throw new Error(`Learned browser provider '${queue.provider}' is no longer available in MCPLab.`);
      const tab = await chrome.tabs.get(queue.tabId);
      const tabOrigin = tab.url ? new URL(tab.url).origin : undefined;
      if (!tabOrigin || !profile.match.origins.includes(tabOrigin)) {
        throw new Error(`${profile.name} is not matched by the active browser tab.`);
      }
    }
    const session = item.sessionId ? await client.get(item.sessionId) : await client.start(item.testCaseId, queue.provider, queue.evaluationRunId);
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
    sendStage(queue, item.testCaseId, 'prompt_sent');
    await chrome.tabs.sendMessage(queue.tabId, {
      type: 'ROVER_ASK',
      requestId,
      sessionId: session.id,
      queueId: queue.queueId,
      queueItemId: item.queueItemId,
      prompt
    });
    sendStage(queue, item.testCaseId, 'waiting_for_response');
  } catch (error) {
    await pauseQueue(queue, error);
  }
}

export async function waitForTabComplete(tabId: number): Promise<void> {
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

async function waitForProviderReady(tabId: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await detectProvider(tabId)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Browser provider composer was not ready after starting a new conversation.');
}

export async function startQueueConversation(queue: RoverQueueState): Promise<void> {
  if (typeof queue.tabId !== 'number') throw new Error('Queue browser tab is unavailable.');
  if (queue.provider === 'trendminer') {
    const response = await chrome.tabs.sendMessage(queue.tabId, { type: 'ROVER_NEW_CHAT', requestId: crypto.randomUUID(), queueId: queue.queueId });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not start a new TrendMiner conversation.');
    return;
  }
  if (queue.provider !== 'claude') {
    const profile = (await new McplabClient(queue.origin).listBrowserProviders()).find((candidate) => candidate.id === queue.provider);
    if (!profile?.newConversation) throw new Error(`${queue.provider} does not have a learned new-conversation action.`);
    const response = await chrome.tabs.sendMessage(queue.tabId, { type: 'ROVER_NEW_CHAT', requestId: crypto.randomUUID(), queueId: queue.queueId });
    if (!response?.ok) throw new Error(response?.error ?? `Could not start a new ${profile.name} conversation.`);
    if (profile.newConversation.action === 'navigate') {
      await waitForTabComplete(queue.tabId);
      await waitForProviderReady(queue.tabId);
      await chrome.tabs.sendMessage(queue.tabId, { type: 'ROVER_SHOW_PANEL' });
    }
    return;
  }
  await chrome.tabs.update(queue.tabId, { url: 'https://claude.ai/new' });
  await waitForTabComplete(queue.tabId);
  await waitForProviderReady(queue.tabId);
  await chrome.tabs.sendMessage(queue.tabId, { type: 'ROVER_SHOW_PANEL' });
}
