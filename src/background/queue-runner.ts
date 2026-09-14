import { McplabClient } from '../mcplab/api-client';
import {
  type RoverQueueState
} from '../queue/state';
import { activeTab, detectProvider } from './browser';
import type { RoverStage } from '../contracts';
import { errorMessage } from './errors';
import { getQueue, saveQueue } from './store';
import { currentSocket } from './socket';
import { scenarioStatusForItem, type ScenarioStatusEvent } from '../mcplab/rover-protocol';

function debugLog(event: string, details: Record<string, unknown> = {}): void {
  console.info(`[Rover debug] ${event}`, details);
}

function sendStage(queue: RoverQueueState, itemId: string, stage: RoverStage): void {
  const socket = currentSocket();
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'stage', jobId: queue.queueId, scenarioId: itemId, stage }));
  }
}

export function sendScenarioStatus(queue: RoverQueueState, item: RoverQueueState['items'][number], lastDurationMs?: number): void {
  const socket = currentSocket();
  if (socket?.readyState !== WebSocket.OPEN) return;
  const event: ScenarioStatusEvent = {
    type: 'scenario_status',
    jobId: queue.queueId,
    scenarioId: item.testCaseId,
    ...scenarioStatusForItem(item),
    ...(lastDurationMs === undefined ? {} : { lastDurationMs })
  };
  socket.send(JSON.stringify(event));
}

export async function cancelActiveQueueItem(queue: RoverQueueState): Promise<void> {
  const item = queue.activeItemId ? queue.items.find((candidate) => candidate.queueItemId === queue.activeItemId) : undefined;
  if (item?.requestId && typeof queue.tabId === 'number') {
    await chrome.tabs.sendMessage(queue.tabId, { type: 'ROVER_CANCEL_ASK', requestId: item.requestId }).catch(() => undefined);
  }
  if (item?.sessionId) await new McplabClient(queue.origin).cancel(item.sessionId).catch(() => undefined);
}

export async function pauseQueue(queue: RoverQueueState, error: unknown, stage: 'browser' | 'mcplab' = 'browser'): Promise<void> {
  const message = errorMessage(error);
  const paused: RoverQueueState = {
    ...queue,
    status: 'paused',
    error: { stage, message },
    items: queue.items.map((item) => item.queueItemId === queue.activeItemId ? { ...item, status: 'error' as const, error: message } : item),
    updatedAt: new Date().toISOString()
  };
  await saveQueue(paused);
  const item = paused.items.find((candidate) => candidate.queueItemId === paused.activeItemId);
  if (item) sendScenarioStatus(paused, item);
}

function isProviderReadinessError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes('was not ready on the active tab') || message.includes('is not matched by the active browser tab');
}

export async function deferQueueItem(queue: RoverQueueState, error: unknown): Promise<void> {
  const message = errorMessage(error);
  const deferred: RoverQueueState = {
    ...queue,
    status: 'running',
    error: { stage: 'browser', message: `Waiting for matching provider page. ${message}` },
    items: queue.items.map((item) => item.queueItemId === queue.activeItemId ? { ...item, status: 'queued' as const, error: undefined, requestId: undefined, sessionId: undefined, startedAt: undefined } : item),
    updatedAt: new Date().toISOString()
  };
  await saveQueue(deferred);
  const item = deferred.items.find((candidate) => candidate.queueItemId === deferred.activeItemId);
  if (item) sendScenarioStatus(deferred, item);
  debugLog('queue item deferred until provider is ready', { queueId: queue.queueId, scenarioId: item?.testCaseId, error: message });
}

export async function runQueueItem(queue: RoverQueueState): Promise<void> {
  const item = queue.items.find((candidate) => candidate.queueItemId === queue.activeItemId);
  if (!item || typeof queue.tabId !== 'number') return;
  if (item.cancelRequestedAt) return;
  try {
    debugLog('starting queue item', { queueId: queue.queueId, scenarioId: item.testCaseId, provider: queue.provider, tabId: queue.tabId });
    const client = new McplabClient(queue.origin);
    let executionTabId: number = queue.tabId;
    if (queue.provider !== 'claude' && queue.provider !== 'trendminer' && queue.provider !== 'chatgpt-com') {
      const profile = (await client.listBrowserProviders()).find((candidate) => candidate.id === queue.provider);
      if (!profile) throw new Error(`Learned browser provider '${queue.provider}' is no longer available in MCPLab.`);
      const tab = await chrome.tabs.get(queue.tabId);
      const tabOrigin = tab.url ? new URL(tab.url).origin : undefined;
      debugLog('checking learned provider tab', { provider: queue.provider, tabId: queue.tabId, tabOrigin, expectedOrigins: profile.match.origins });
      if (!tabOrigin || !profile.match.origins.includes(tabOrigin)) {
        const current = await activeTab();
        const currentOrigin = current?.url ? new URL(current.url).origin : undefined;
        if (typeof current?.id === 'number' && currentOrigin && profile.match.origins.includes(currentOrigin)) {
          executionTabId = current.id;
        } else {
          throw new Error(`${profile.name} is not matched by the active browser tab.`);
        }
      }
      if (executionTabId !== queue.tabId) {
        queue = { ...queue, tabId: executionTabId };
      }
    }
    await waitForProviderReady(executionTabId, queue.provider);
    const session = item.sessionId ? await client.get(item.sessionId) : await client.start(item.testCaseId, queue.provider, queue.evaluationRunId, {
      configPath: queue.sourceConfigPath,
      configName: queue.sourceConfigName,
      agentName: queue.sourceAgentName
    });
    const prompt = item.prompt || session.prompt;
    const requestId = crypto.randomUUID();
    const running: RoverQueueState = {
      ...queue,
      items: queue.items.map((candidate) => candidate.queueItemId === item.queueItemId
        ? { ...candidate, prompt, sessionId: session.id, requestId, status: 'running' as const, startedAt: new Date().toISOString() }
        : candidate),
      updatedAt: new Date().toISOString()
    };
    const latest = await getQueue();
    const latestItem = latest?.items.find((candidate) => candidate.queueItemId === item.queueItemId);
    if (!latest || latest.queueId !== queue.queueId || latest.activeItemId !== item.queueItemId || latestItem?.cancelRequestedAt) return;
    await saveQueue(running);
    sendScenarioStatus(running, running.items.find((candidate) => candidate.queueItemId === item.queueItemId)!);
    sendStage(queue, item.testCaseId, 'prompt_sent');
    await chrome.tabs.sendMessage(executionTabId, {
      type: 'ROVER_ASK',
      requestId,
      sessionId: session.id,
      queueId: queue.queueId,
      queueItemId: item.queueItemId,
      prompt
    });
    debugLog('prompt sent to content script', { queueId: queue.queueId, scenarioId: item.testCaseId, tabId: executionTabId });
    sendStage(queue, item.testCaseId, 'waiting_for_response');
  } catch (error) {
    if (queue.evaluationRunId && isProviderReadinessError(error)) {
      await deferQueueItem(queue, error);
      return;
    }
    debugLog('queue item paused after error', { queueId: queue.queueId, scenarioId: item.testCaseId, error: error instanceof Error ? error.message : String(error) });
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

async function waitForProviderReady(tabId: number, expectedProvider?: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const provider = await detectProvider(tabId);
    if (provider && (!expectedProvider || provider === expectedProvider)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Browser provider '${expectedProvider ?? 'unknown'}' was not ready on the active tab.`);
}

export async function startQueueConversation(queue: RoverQueueState): Promise<void> {
  if (typeof queue.tabId !== 'number') throw new Error('Queue browser tab is unavailable.');
  if (queue.provider === 'trendminer') {
    const response = await chrome.tabs.sendMessage(queue.tabId, { type: 'ROVER_NEW_CHAT', requestId: crypto.randomUUID(), queueId: queue.queueId });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not start a new TrendMiner conversation.');
    return;
  }
  if (queue.provider === 'chatgpt-com') {
    const response = await chrome.tabs.sendMessage(queue.tabId, { type: 'ROVER_NEW_CHAT', requestId: crypto.randomUUID(), queueId: queue.queueId });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not start a new ChatGPT conversation.');
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
