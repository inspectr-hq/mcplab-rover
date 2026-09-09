import type { ProviderId } from '../contracts';
import { McplabClient } from '../mcplab/api-client';
import { createQueue, startQueue, stopQueue } from '../queue/state';
import { activeTab, detectProvider } from './browser';
import { cancelActiveQueueItem, runQueueItem } from './queue-runner';
import { getQueue, resolveOrigin, saveQueue } from './store';

let roverSocket: WebSocket | null = null;
let roverReconnectAttempt = 0;

export function currentSocket(): WebSocket | null {
  return roverSocket;
}

export async function connectToMcplab(): Promise<void> {
  const origin = await resolveOrigin();
  if (roverSocket && (roverSocket.readyState === WebSocket.OPEN || roverSocket.readyState === WebSocket.CONNECTING)) return;
  const wsOrigin = origin.replace(/^http/i, 'ws');
  const socket = new WebSocket(`${wsOrigin}/api/rover/ws`);
  roverSocket = socket;
  socket.onopen = async () => {
    roverReconnectAttempt = 0;
    const tab = await activeTab();
    const provider = typeof tab?.id === 'number' ? await detectProvider(tab.id) : undefined;
    if (!provider) return;
    socket.send(JSON.stringify({ type: 'register', protocolVersion: 1, provider, pageUrl: tab?.url ?? '', extensionVersion: chrome.runtime.getManifest().version }));
  };
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as { type?: string; jobId?: string; evaluationRunId?: string; agent?: { provider?: ProviderId }; scenarios?: Array<{ id: string; name?: string; prompt: string; eval?: unknown }>; newConversationBetweenScenarios?: boolean };
      if (message.type === 'stop' && message.jobId) {
        void (async () => {
          const queue = await getQueue();
          if (!queue || queue.queueId !== message.jobId) return;
          await cancelActiveQueueItem(queue);
          await saveQueue(stopQueue(queue, new Date().toISOString()));
        })();
        return;
      }
      if (message.type !== 'assignment' || !message.jobId || !message.agent?.provider || !message.scenarios?.length) return;
      void (async () => {
        const tab = await activeTab();
        if (typeof tab?.id !== 'number') return;
        const queue = createQueue(origin, message.agent!.provider!, message.newConversationBetweenScenarios !== false, new Date().toISOString());
        const assigned = { ...queue, queueId: message.jobId!, evaluationRunId: message.evaluationRunId, tabId: tab.id, items: message.scenarios!.map((scenario) => ({ queueItemId: crypto.randomUUID(), testCaseId: scenario.id, id: scenario.id, name: scenario.name ?? scenario.id, prompt: scenario.prompt, assertionCount: 0, status: 'queued' as const })) };
        await saveQueue(assigned);
        const started = startQueue(assigned, new Date().toISOString());
        await saveQueue(started);
        await runQueueItem(started);
      })();
    } catch { /* ignore malformed server messages */ }
  };
  socket.onclose = () => {
    if (roverSocket !== socket) return;
    roverSocket = null;
    if (roverReconnectAttempt >= 8) return;
    const delay = Math.min(30_000, 1_000 * 2 ** roverReconnectAttempt);
    roverReconnectAttempt += 1;
    setTimeout(() => { void connectToMcplab().catch(() => undefined); }, delay);
  };
}

export async function updateRoverRegistration(tabId: number): Promise<void> {
  if (!roverSocket || roverSocket.readyState !== WebSocket.OPEN) return;
  const provider = await detectProvider(tabId);
  if (!provider) return;
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  roverSocket.send(JSON.stringify({ type: 'register_update', provider, pageUrl: tab?.url ?? '' }));
}

