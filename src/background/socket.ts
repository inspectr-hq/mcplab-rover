import type { ProviderId } from '../contracts';
import type { WaitingEvaluation } from '../contracts';
import { McplabClient } from '../mcplab/api-client';
import { archiveCompletedQueueItems, createQueue, startQueue, stopQueue, stopScenario } from '../queue/state';
import { activeTab, detectProvider } from './browser';
import { cancelActiveQueueItem, failManagedQueue, pauseQueue, runQueueItem, sendScenarioStatus, startQueueConversation } from './queue-runner';
import { registrationPayload } from '../mcplab/rover-protocol';
import { getQueue, resolveOrigin, saveQueue } from './store';
import type { RoverQueueState } from '../queue/state';
import { queueNeedsResume } from '../queue/recovery';
import { serializeQueueOperation } from '../queue/operations';

let roverSocket: WebSocket | null = null;
let registeredSocket: WebSocket | null = null;
let registeredTabId: number | undefined;
let roverReconnectAttempt = 0;
let roverHeartbeat: ReturnType<typeof setInterval> | null = null;
let roverLeaseRenewal: ReturnType<typeof setInterval> | null = null;
let negotiatedCapabilities: string[] = [];
let lastLeaseRenewalAt: string | undefined;
let lastAssignmentDecision: { decision: string; reason?: string; at: string } | undefined;
let waitingEvaluations: WaitingEvaluation[] = [];
const loadedProviders = new Map<string, import('../mcplab/types').BrowserProviderProfile>();

function stopLeaseRenewal(): void {
  if (roverLeaseRenewal) clearInterval(roverLeaseRenewal);
  roverLeaseRenewal = null;
}

export async function startLeaseRenewal(queue: RoverQueueState): Promise<void> {
  stopLeaseRenewal();
  if (!queue.leaseId || !negotiatedCapabilities.includes('assignment_lease')) return;
  roverLeaseRenewal = setInterval(() => {
    void serializeQueueOperation(async () => {
      const latest = await getQueue();
      if (!latest?.leaseId || latest.status !== 'running' || !roverSocket || roverSocket.readyState !== WebSocket.OPEN) {
        stopLeaseRenewal();
        return;
      }
      const leaseExpiresAt = new Date(Date.now() + 30_000).toISOString();
      roverSocket.send(JSON.stringify({ type: 'lease_renew', jobId: latest.queueId, leaseId: latest.leaseId, leaseExpiresAt }));
      lastLeaseRenewalAt = new Date().toISOString();
      await saveQueue({ ...latest, leaseExpiresAt, updatedAt: new Date().toISOString() });
    }).catch((error) => debugLog('lease renewal failed', { error: error instanceof Error ? error.message : String(error) }));
  }, 15_000);
}

export function clearLease(queue: RoverQueueState): RoverQueueState {
  const { leaseId: _leaseId, leaseExpiresAt: _leaseExpiresAt, leaseState: _leaseState, ...withoutLease } = queue;
  return withoutLease;
}

export function releaseLease(queue: RoverQueueState, reason: 'completed' | 'error' | 'stopped' | 'connection_lost'): RoverQueueState {
  if (!queue.leaseId) return queue;
  if (negotiatedCapabilities.includes('assignment_lease') && roverSocket?.readyState === WebSocket.OPEN) {
    roverSocket.send(JSON.stringify({ type: 'lease_release', jobId: queue.queueId, leaseId: queue.leaseId, reason }));
  }
  lastAssignmentDecision = { decision: 'released', reason, at: new Date().toISOString() };
  if (reason !== 'connection_lost') stopLeaseRenewal();
  return clearLease(queue);
}

function debugLog(event: string, details: Record<string, unknown> = {}): void {
  console.info(`[Rover debug] ${event}`, details);
}

async function reconcileQueueAfterRegistration(origin: string): Promise<void> {
  const queue = await getQueue();
  if (!queue || queue.status !== 'running') return;
  if (!queue.evaluationRunId) {
    if (queueNeedsResume(queue)) await runQueueItem(queue);
    return;
  }
  try {
    const snapshot = await new McplabClient(origin).getQueue();
    const liveJobIds = [
      snapshot.active?.jobId,
      ...(snapshot.active_jobs ?? []).map((job) => job.jobId),
      ...(snapshot.admitting_jobs ?? []).map((job) => job.jobId),
      ...(snapshot.queued ?? []).map((job) => job.jobId)
    ].filter((jobId): jobId is string => Boolean(jobId));
    if (liveJobIds.includes(queue.queueId)) {
      await startLeaseRenewal(queue);
      if (queueNeedsResume(queue)) await runQueueItem(queue);
      return;
    }
    stopLeaseRenewal();
    await saveQueue(createQueue(origin, queue.provider, queue.newConversationBetweenItems, new Date().toISOString()));
  } catch {
    // Preserve local state if MCPLab is temporarily unreachable.
  }
}

export function currentSocket(): WebSocket | null {
  return roverSocket;
}

export function leaseDebugState(): { negotiatedCapabilities: string[]; lastLeaseRenewalAt?: string; lastAssignmentDecision?: { decision: string; reason?: string; at: string } } {
  return { negotiatedCapabilities: [...negotiatedCapabilities], lastLeaseRenewalAt, lastAssignmentDecision };
}

export function waitingForMatching(): WaitingEvaluation[] {
  return waitingEvaluations.map((job) => ({ ...job }));
}

export function loadedProvider(providerId?: string): import('../mcplab/types').BrowserProviderProfile | undefined {
  return providerId ? loadedProviders.get(providerId) : undefined;
}

export async function loadProfilesIntoTab(tabId: number, origin: string): Promise<void> {
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
  waitingEvaluations = [];
  if (roverSocket && (roverSocket.readyState === WebSocket.OPEN || roverSocket.readyState === WebSocket.CONNECTING)) return;
  const initialTab = await activeTab();
  if (typeof initialTab?.id !== 'number') {
    debugLog('waiting for an active tab before connecting');
    return;
  }
  debugLog('connecting', { origin });
  const wsOrigin = origin.replace(/^http/i, 'ws');
  const socket = new WebSocket(`${wsOrigin}/api/rover/ws`);
  roverSocket = socket;
  registeredSocket = null;
  registeredTabId = undefined;
  socket.onopen = async () => {
    roverReconnectAttempt = 0;
    if (roverHeartbeat) clearInterval(roverHeartbeat);
    roverHeartbeat = null;
    const tab = await activeTab();
    let provider = typeof tab?.id === 'number' ? await detectProvider(tab.id) : undefined;
    if (typeof tab?.id === 'number') {
      await loadProfilesIntoTab(tab.id, origin);
      provider = await detectProvider(tab.id);
    }
    debugLog('provider detection complete', { tabId: tab?.id, tabOrigin: tab?.url ? new URL(tab.url).origin : undefined, provider });
    if (!provider) {
      // Chrome can report no active tab while the extension or service-worker
      // inspector has focus. Keep the transport open and let tab activation or
      // navigation register the provider once a page is available.
      debugLog('waiting for an active supported tab');
      return;
    }
    socket.send(JSON.stringify(registrationPayload(provider, tab?.url ?? '', chrome.runtime.getManifest().version, loadedProviders.get(provider)?.learned.updatedAt)));
    registeredTabId = typeof tab?.id === 'number' ? tab.id : undefined;
    debugLog('registration sent', { provider, tabId: tab?.id });
    // Start heartbeats only after sending registration. The server rejects
    // non-registration messages from an unregistered WebSocket.
    roverHeartbeat = setInterval(() => {
      if (roverSocket !== socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: 'heartbeat' }));
    }, 20_000);
  };
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as { type?: string; capabilities?: unknown; leaseId?: string; leaseExpiresAt?: string; tabId?: number; jobId?: string; scenarioId?: string; evaluationRunId?: string; configPath?: string; evaluationName?: string; agentName?: string; agent?: { provider?: ProviderId; providerRevision?: string }; provider?: import('../mcplab/types').BrowserProviderProfile; scenarios?: Array<{ id: string; name?: string; prompt: string; eval?: unknown }>; newConversationBetweenScenarios?: boolean };
      if (message.type === 'registered' && roverSocket === socket) {
        registeredSocket = socket;
        negotiatedCapabilities = Array.isArray(message.capabilities)
          ? message.capabilities.filter((value): value is string => typeof value === 'string')
          : [];
        debugLog('registration acknowledged', { capabilities: negotiatedCapabilities });
        void serializeQueueOperation(() => reconcileQueueAfterRegistration(origin)).catch((error) => {
          debugLog('queue reconciliation failed', { error: error instanceof Error ? error.message : String(error) });
        });
      }
      if (message.type === 'provider_updated' && message.provider) {
        loadedProviders.set(message.provider.id, message.provider);
        void activeTab().then((tab) => typeof tab?.id === 'number'
          ? chrome.tabs.sendMessage(tab.id, { type: 'ROVER_SET_PROFILES', profiles: [...loadedProviders.values()] }).catch(() => undefined)
          : undefined);
        return;
      }
      if (message.type === 'queue_waiting' && Array.isArray((message as { jobs?: unknown }).jobs)) {
        waitingEvaluations = ((message as { jobs: unknown[] }).jobs).filter((job): job is WaitingEvaluation => {
          if (!job || typeof job !== 'object') return false;
          const candidate = job as Partial<WaitingEvaluation>;
          return typeof candidate.jobId === 'string' && typeof candidate.provider === 'string' && typeof candidate.position === 'number';
        });
        return;
      }
      if (message.type === 'stop' && message.jobId) {
        debugLog('stop command received', { jobId: message.jobId });
        void serializeQueueOperation(async () => {
          const queue = await getQueue();
          if (!queue || queue.queueId !== message.jobId) return;
          await cancelActiveQueueItem(queue);
          const released = clearLease(queue);
          await saveQueue(stopQueue(released, new Date().toISOString()));
          releaseLease(queue, 'stopped');
        }).catch((error) => {
          debugLog('whole queue stop failed', { error: error instanceof Error ? error.message : String(error) });
        });
        return;
      }
      if (message.type === 'stop_scenario' && message.jobId && message.scenarioId) {
        debugLog('stop_scenario command received', { jobId: message.jobId, scenarioId: message.scenarioId });
        void serializeQueueOperation(async () => {
          const queue = await getQueue();
          const item = queue?.activeItemId
            ? queue.items.find((candidate) => candidate.queueItemId === queue.activeItemId && candidate.testCaseId === message.scenarioId)
              ?? queue.items.find((candidate) => candidate.testCaseId === message.scenarioId && candidate.status === 'queued')
            : queue?.items.find((candidate) => candidate.testCaseId === message.scenarioId && candidate.status === 'queued');
          if (!queue || queue.queueId !== message.jobId || !item) return;
          const wasActive = queue.activeItemId === item.queueItemId;
          const next = stopScenario(queue, message.scenarioId!, new Date().toISOString());
          await saveQueue(next);
          const stopped = next.items.find((candidate) => candidate.queueItemId === item.queueItemId);
          if (stopped?.status === 'stopped') sendScenarioStatus(next, stopped);
          if (roverSocket?.readyState === WebSocket.OPEN) {
            roverSocket.send(JSON.stringify({
              type: 'progress',
              jobId: next.queueId,
              ...(next.leaseId ? { leaseId: next.leaseId } : {}),
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
                if (next.leaseId) await failManagedQueue(next, error);
                else await pauseQueue(next, error);
              }
            } else if (next.status === 'completed') {
              await saveQueue(clearLease(next));
              if (roverSocket?.readyState === WebSocket.OPEN) {
                roverSocket.send(JSON.stringify({ type: 'complete', jobId: next.queueId, outcome: 'incomplete', ...(next.leaseId ? { leaseId: next.leaseId } : {}) }));
              }
              releaseLease(next, 'stopped');
            }
          }
        }).catch((error) => {
          debugLog('scenario stop failed', { error: error instanceof Error ? error.message : String(error) });
        });
        return;
      }
      if (message.type !== 'assignment' || !message.jobId || !message.agent?.provider || !message.scenarios?.length) return;
      debugLog('assignment received', { jobId: message.jobId, provider: message.agent.provider, scenarios: message.scenarios.length });
      const leaseBearing = typeof message.leaseId === 'string' && negotiatedCapabilities.includes('assignment_lease');
      const reportAssignmentError = (reason: string) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'progress', jobId: message.jobId, completed: 0, total: message.scenarios?.length ?? 0, error: reason, message: `Rover could not start the assignment: ${reason}` }));
        }
      };
      const rejectAssignment = (reason: string) => {
        lastAssignmentDecision = { decision: 'rejected', reason, at: new Date().toISOString() };
        if (leaseBearing && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'assignment_reject', jobId: message.jobId, leaseId: message.leaseId, reason, retryable: true }));
        } else {
          reportAssignmentError(reason);
        }
      };
      void serializeQueueOperation(async () => {
        if (leaseBearing && (!message.leaseExpiresAt || Date.parse(message.leaseExpiresAt) <= Date.now())) {
          rejectAssignment('expired_assignment');
          return;
        }
        const registeredTab = typeof registeredTabId === 'number'
          ? await chrome.tabs.get(registeredTabId).catch(() => undefined)
          : undefined;
        const tab = registeredTab ?? await activeTab();
        if (typeof tab?.id !== 'number') {
          rejectAssignment('provider_unavailable');
          return;
        }
        const detectedProvider = await detectProvider(tab.id);
        if (detectedProvider !== message.agent!.provider) {
          rejectAssignment('provider_mismatch');
          return;
        }
        if (message.agent?.providerRevision && loadedProviders.get(message.agent.provider ?? '')?.learned.updatedAt !== message.agent.providerRevision) {
          await loadProfilesIntoTab(tab.id, origin);
          if (loadedProviders.get(message.agent.provider ?? '')?.learned.updatedAt !== message.agent.providerRevision) {
            rejectAssignment('stale_provider');
            return;
          }
        }
        const scenarioIds = message.scenarios!.map((scenario) => scenario.id);
        if (new Set(scenarioIds).size !== scenarioIds.length) {
          rejectAssignment('invalid_assignment');
          return;
        }
        const previous = await getQueue();
        if (previous && ['running', 'paused'].includes(previous.status) && (leaseBearing || Boolean(previous.leaseId))) {
          rejectAssignment('busy');
          return;
        }
        const history = previous ? archiveCompletedQueueItems(previous).recentHistory : undefined;
        const queue = createQueue(origin, message.agent!.provider!, message.newConversationBetweenScenarios !== false, new Date().toISOString());
        const assigned = { ...queue, recentHistory: history, queueId: message.jobId!, evaluationRunId: message.evaluationRunId, sourceConfigPath: message.configPath, sourceConfigName: message.evaluationName, sourceAgentName: message.agentName, tabId: tab.id, ...(leaseBearing ? { leaseId: message.leaseId, leaseExpiresAt: message.leaseExpiresAt, leaseState: 'offered' as const } : {}), items: message.scenarios!.map((scenario) => ({ queueItemId: crypto.randomUUID(), testCaseId: scenario.id, id: scenario.id, name: scenario.name ?? scenario.id, prompt: scenario.prompt, assertionCount: 0, status: 'queued' as const })) };
        await saveQueue(assigned);
        if (leaseBearing) {
          if (socket.readyState !== WebSocket.OPEN) throw new Error('Rover connection closed before assignment acceptance.');
          socket.send(JSON.stringify({ type: 'assignment_accept', jobId: message.jobId, leaseId: message.leaseId, tabId: tab.id }));
          lastAssignmentDecision = { decision: 'accepted', at: new Date().toISOString() };
          waitingEvaluations = waitingEvaluations.filter((job) => job.jobId !== message.jobId);
        }
        for (const item of assigned.items) sendScenarioStatus(assigned, item);
        const started = { ...startQueue(assigned, new Date().toISOString()), ...(leaseBearing ? { leaseState: 'running' as const } : {}) };
        await saveQueue(started);
        await startLeaseRenewal(started);
        await runQueueItem(started);
      }).catch(async (error) => {
        reportAssignmentError(error instanceof Error ? error.message : String(error));
        try {
          if (leaseBearing) {
            const currentQueue = await getQueue();
            if (currentQueue && currentQueue.queueId === message.jobId && currentQueue.leaseId === message.leaseId) {
              await saveQueue(clearLease(currentQueue));
              releaseLease(currentQueue, 'error');
            }
          }
        } catch (cleanupError) {
          debugLog('assignment cleanup failed', { error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) });
        }
        debugLog('assignment handling failed', { error: error instanceof Error ? error.message : String(error) });
      });
    } catch { /* ignore malformed server messages */ }
  };
  socket.onclose = (event) => {
    if (roverSocket !== socket) return;
    if (roverHeartbeat) {
      clearInterval(roverHeartbeat);
      roverHeartbeat = null;
    }
    stopLeaseRenewal();
    waitingEvaluations = [];
    roverSocket = null;
    if (registeredSocket === socket) registeredSocket = null;
    if (registeredSocket === null) registeredTabId = undefined;
    debugLog('socket closed', { code: event.code, reason: event.reason, wasClean: event.wasClean });
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
  void chrome.runtime.sendMessage({ type: 'ROVER_ACTIVE_PROVIDER_CHANGED', provider }).catch(() => undefined);
  if (!provider) return;
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (registeredSocket !== roverSocket) {
    roverSocket.send(JSON.stringify(registrationPayload(provider, tab?.url ?? '', chrome.runtime.getManifest().version, loadedProviders.get(provider)?.learned.updatedAt)));
    registeredTabId = tabId;
    return;
  }
  roverSocket.send(JSON.stringify({ type: 'register_update', provider, providerRevision: loadedProviders.get(provider)?.learned.updatedAt, pageUrl: tab?.url ?? '' }));
  registeredTabId = tabId;
  await serializeQueueOperation(() => reconcileQueueAfterRegistration(origin));
}
