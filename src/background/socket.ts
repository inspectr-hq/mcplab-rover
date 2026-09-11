import type { ProviderId } from '../contracts';
import { McplabClient } from '../mcplab/api-client';
import { createQueue, startQueue, stopQueue, stopScenario } from '../queue/state';
import { activeTab, detectProvider } from './browser';
import { cancelActiveQueueItem, markScenarioCancelled, pauseQueue, runQueueItem, sendScenarioStatus, startQueueConversation } from './queue-runner';
import { registrationPayload } from '../mcplab/rover-protocol';
import { getQueue, resolveOrigin, saveQueue } from './store';

let roverSocket: WebSocket | null = null;
let registeredSocket: WebSocket | null = null;
let roverReconnectAttempt = 0;
const loadedProviders = new Map<string, import('../mcplab/types').BrowserProviderProfile>();

export function currentSocket(): WebSocket | null {
  return roverSocket;
}

export function loadedProvider(providerId?: string): import('../mcplab/types').BrowserProviderProfile | undefined {
  return providerId ? loadedProviders.get(providerId) : undefined;
}

async function loadProfilesIntoTab(tabId: number, origin: string): Promise<void> {
  let profiles: import('../mcplab/types').BrowserProviderProfile[];
  try {
    profiles = await new McplabClient(origin).listBrowserProviders();
  } catch {
    return;
  }
  loadedProviders.clear();
  for (const profile of profiles) loadedProviders.set(profile.id, profile);
  await chrome.tabs.sendMessage(tabId, { type: 'ROVER_SET_PROFILES', profiles }).catch(() => undefined);
}

export async function connectToMcplab(): Promise<void> {
  const origin = await resolveOrigin();
  if (roverSocket && (roverSocket.readyState === WebSocket.OPEN || roverSocket.readyState === WebSocket.CONNECTING)) return;
  const wsOrigin = origin.replace(/^http/i, 'ws');
  const socket = new WebSocket(`${wsOrigin}/api/rover/ws`);
  roverSocket = socket;
  registeredSocket = null;
  socket.onopen = async () => {
    roverReconnectAttempt = 0;
    const tab = await activeTab();
    let provider = typeof tab?.id === 'number' ? await detectProvider(tab.id) : undefined;
    if (typeof tab?.id === 'number') {
      await loadProfilesIntoTab(tab.id, origin);
      provider = await detectProvider(tab.id);
    }
    if (!provider) {
      socket.close(1000, 'No supported Rover provider is active');
      return;
    }
    socket.send(JSON.stringify(registrationPayload(provider, tab?.url ?? '', chrome.runtime.getManifest().version)));
  };
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as { type?: string; jobId?: string; scenarioId?: string; evaluationRunId?: string; agent?: { provider?: ProviderId; providerRevision?: string }; provider?: import('../mcplab/types').BrowserProviderProfile; scenarios?: Array<{ id: string; name?: string; prompt: string; eval?: unknown }>; newConversationBetweenScenarios?: boolean };
      if (message.type === 'registered' && roverSocket === socket) registeredSocket = socket;
      if (message.type === 'provider_updated' && message.provider) {
        loadedProviders.set(message.provider.id, message.provider);
        void activeTab().then((tab) => typeof tab?.id === 'number'
          ? chrome.tabs.sendMessage(tab.id, { type: 'ROVER_SET_PROFILES', profiles: [...loadedProviders.values()] }).catch(() => undefined)
          : undefined);
        return;
      }
      if (message.type === 'stop' && message.jobId) {
        void (async () => {
          const queue = await getQueue();
          if (!queue || queue.queueId !== message.jobId) return;
          if (queue.activeItemId) {
            const active = queue.items.find((candidate) => candidate.queueItemId === queue.activeItemId);
            if (active) markScenarioCancelled(queue.queueId, active.queueItemId);
          }
          await cancelActiveQueueItem(queue);
          await saveQueue(stopQueue(queue, new Date().toISOString()));
        })();
        return;
      }
      if (message.type === 'stop_scenario' && message.jobId && message.scenarioId) {
        void (async () => {
          const queue = await getQueue();
          const item = queue?.items.find((candidate) => candidate.testCaseId === message.scenarioId);
          if (!queue || queue.queueId !== message.jobId || !item) return;
          const wasActive = queue.activeItemId === item.queueItemId;
          if (wasActive) markScenarioCancelled(queue.queueId, item.queueItemId);
          const next = stopScenario(queue, message.scenarioId!, new Date().toISOString());
          await saveQueue(next);
          const stopped = next.items.find((candidate) => candidate.queueItemId === item.queueItemId);
          if (stopped?.status === 'stopped') sendScenarioStatus(next, stopped);
          if (roverSocket?.readyState === WebSocket.OPEN) {
            roverSocket.send(JSON.stringify({
              type: 'progress',
              jobId: next.queueId,
              completed: next.items.filter((candidate) => ['passed', 'failed', 'incomplete', 'skipped', 'stopped'].includes(candidate.status)).length,
              total: next.items.length,
              currentScenarioId: next.activeItemId ? next.items.find((candidate) => candidate.queueItemId === next.activeItemId)?.testCaseId : undefined
            }));
          }
          if (wasActive) {
            await cancelActiveQueueItem(queue);
            if (next.status === 'running') {
              try {
                if (next.newConversationBetweenItems) await startQueueConversation(next);
                await runQueueItem(next);
              } catch (error) {
                await pauseQueue(next, error);
              }
            } else if (next.status === 'completed' && roverSocket?.readyState === WebSocket.OPEN) {
              roverSocket.send(JSON.stringify({ type: 'complete', jobId: next.queueId, outcome: 'incomplete' }));
            }
          }
        })();
        return;
      }
      if (message.type !== 'assignment' || !message.jobId || !message.agent?.provider || !message.scenarios?.length) return;
      void (async () => {
        const reportAssignmentError = (reason: string) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'progress', jobId: message.jobId, completed: 0, total: message.scenarios?.length ?? 0, error: reason, message: `Rover could not start the assignment: ${reason}` }));
          }
        };
        const tab = await activeTab();
        if (typeof tab?.id !== 'number') {
          reportAssignmentError('No active browser tab is available.');
          return;
        }
        if (message.agent?.providerRevision && loadedProviders.get(message.agent.provider ?? '')?.learned.updatedAt !== message.agent.providerRevision) {
          await loadProfilesIntoTab(tab.id, origin);
          if (loadedProviders.get(message.agent.provider ?? '')?.learned.updatedAt !== message.agent.providerRevision) {
            reportAssignmentError(`Provider '${message.agent.provider}' is unavailable or out of date.`);
            return;
          }
        }
        const scenarioIds = message.scenarios!.map((scenario) => scenario.id);
        if (new Set(scenarioIds).size !== scenarioIds.length) {
          reportAssignmentError('Assignment scenarios must have unique IDs.');
          return;
        }
        const queue = createQueue(origin, message.agent!.provider!, message.newConversationBetweenScenarios !== false, new Date().toISOString());
        const assigned = { ...queue, queueId: message.jobId!, evaluationRunId: message.evaluationRunId, tabId: tab.id, items: message.scenarios!.map((scenario) => ({ queueItemId: crypto.randomUUID(), testCaseId: scenario.id, id: scenario.id, name: scenario.name ?? scenario.id, prompt: scenario.prompt, assertionCount: 0, status: 'queued' as const })) };
        await saveQueue(assigned);
        for (const item of assigned.items) sendScenarioStatus(assigned, item);
        const started = startQueue(assigned, new Date().toISOString());
        await saveQueue(started);
        await runQueueItem(started);
      })();
    } catch { /* ignore malformed server messages */ }
  };
  socket.onclose = () => {
    if (roverSocket !== socket) return;
    roverSocket = null;
    if (registeredSocket === socket) registeredSocket = null;
    if (roverReconnectAttempt >= 8) return;
    const delay = Math.min(30_000, 1_000 * 2 ** roverReconnectAttempt);
    roverReconnectAttempt += 1;
    setTimeout(() => { void connectToMcplab().catch(() => undefined); }, delay);
  };
}

export async function updateRoverRegistration(tabId: number): Promise<void> {
  const origin = await resolveOrigin();
  await detectProvider(tabId);
  await loadProfilesIntoTab(tabId, origin);
  if (!roverSocket || roverSocket.readyState !== WebSocket.OPEN) {
    void connectToMcplab().catch(() => undefined);
    return;
  }
  const provider = await detectProvider(tabId);
  if (!provider) return;
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (registeredSocket !== roverSocket) {
    roverSocket.send(JSON.stringify(registrationPayload(provider, tab?.url ?? '', chrome.runtime.getManifest().version)));
    return;
  }
  roverSocket.send(JSON.stringify({ type: 'register_update', provider, pageUrl: tab?.url ?? '' }));
}
