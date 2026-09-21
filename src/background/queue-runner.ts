import { McplabClient } from '../mcplab/api-client';
import {
  createQueue,
  isCompletedQueueItemStatus,
  recordQueueItemOutcome,
  type RoverQueueState
} from '../queue/state';
import { activeTab, detectProvider } from './browser';
import { errorMessage } from './errors';
import { getQueue, saveQueue } from './store';
import { clearLease, currentSocket, persistLeaseRelease } from './lease-transport';
import { scenarioStatusForItem, type ScenarioStatusEvent } from '../mcplab/rover-protocol';
import type { RoverLeaseReleaseReason } from '../mcplab/rover-protocol';
import { selectMatchingExecutionTab } from './execution-tab';
import { enqueueLeaseActions } from '../queue/lease-outbox';
import { isBuiltInProvider } from '../providers/catalog';
import { sendStage } from './queue-message-helpers';
import { debugLog } from './debug-logging';

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function isIncompleteError(error: unknown): boolean {
  return errorCode(error) === 'incomplete';
}

export function sendScenarioStatus(
  queue: RoverQueueState,
  item: RoverQueueState['items'][number],
  lastDurationMs?: number
): void {
  const socket = currentSocket();
  if (socket?.readyState !== WebSocket.OPEN) return;
  const event: ScenarioStatusEvent = {
    type: 'scenario_status',
    jobId: queue.queueId,
    scenarioId: item.testCaseId,
    ...(queue.leaseId ? { leaseId: queue.leaseId } : {}),
    ...scenarioStatusForItem(item),
    ...(lastDurationMs === undefined ? {} : { lastDurationMs })
  };
  socket.send(JSON.stringify(event));
}

export async function cancelActiveQueueItem(queue: RoverQueueState): Promise<void> {
  const item = queue.activeItemId
    ? queue.items.find((candidate) => candidate.queueItemId === queue.activeItemId)
    : undefined;
  if (item?.requestId && typeof queue.tabId === 'number') {
    await chrome.tabs
      .sendMessage(queue.tabId, { type: 'ROVER_CANCEL_ASK', requestId: item.requestId })
      .catch(() => undefined);
  }
  if (item?.sessionId)
    await new McplabClient(queue.origin).cancel(item.sessionId).catch(() => undefined);
}

export async function finalizeManagedQueue(
  queue: RoverQueueState,
  options: { outcome: string; releaseReason: RoverLeaseReleaseReason; runId?: string }
): Promise<void> {
  if (!queue.leaseId) return;
  const leaseId = queue.leaseId;
  const finalizing = {
    ...queue,
    managedPhase: 'finalizing' as const,
    updatedAt: new Date().toISOString()
  };
  await saveQueue(finalizing);
  const socket = currentSocket();
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: 'complete',
        jobId: finalizing.queueId,
        outcome: options.outcome,
        ...(options.runId ? { runId: options.runId } : {}),
        leaseId
      })
    );
    await persistLeaseRelease(finalizing, options.releaseReason);
    return;
  }
  await saveQueue(
    enqueueLeaseActions(clearLease(finalizing), [
      {
        type: 'complete',
        leaseId,
        outcome: options.outcome,
        ...(options.runId ? { runId: options.runId } : {}),
        firstQueuedAt: new Date().toISOString()
      },
      {
        type: 'release',
        leaseId,
        reason: options.releaseReason,
        firstQueuedAt: new Date().toISOString()
      }
    ])
  );
}

export async function pauseQueue(
  queue: RoverQueueState,
  error: unknown,
  stage: 'browser' | 'mcplab' = 'browser'
): Promise<void> {
  const message = errorMessage(error);
  const paused: RoverQueueState = {
    ...queue,
    status: 'paused',
    error: { stage, message },
    items: queue.items.map((item) =>
      item.queueItemId === queue.activeItemId
        ? {
            ...item,
            status: isIncompleteError(error) ? ('incomplete' as const) : ('error' as const),
            error: message
          }
        : item
    ),
    updatedAt: new Date().toISOString()
  };
  await saveQueue(paused);
  const item = paused.items.find((candidate) => candidate.queueItemId === paused.activeItemId);
  if (item) sendScenarioStatus(paused, item);
}

export async function failManagedQueue(
  queue: RoverQueueState,
  error: unknown,
  stage: 'browser' | 'mcplab' = 'browser'
): Promise<void> {
  if (!queue.leaseId || !queue.activeItemId) {
    await pauseQueue(queue, error, stage);
    return;
  }
  const message = errorMessage(error);
  const itemOutcome = isIncompleteError(error) ? ('incomplete' as const) : ('error' as const);
  const failed = recordQueueItemOutcome(
    queue,
    queue.activeItemId,
    itemOutcome,
    { error: message },
    new Date().toISOString()
  );
  await saveQueue(failed);
  const item = failed.items.find(
    (candidate) =>
      candidate.testCaseId ===
        queue.items.find((current) => current.queueItemId === queue.activeItemId)?.testCaseId &&
      candidate.status === itemOutcome
  );
  if (item) sendScenarioStatus(failed, item);
  const socket = currentSocket();
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: 'progress',
        jobId: failed.queueId,
        ...(failed.leaseId ? { leaseId: failed.leaseId } : {}),
        completed: failed.items.filter((candidate) => isCompletedQueueItemStatus(candidate.status))
          .length,
        total: failed.items.length,
        currentScenarioId: failed.activeItemId
          ? failed.items.find((candidate) => candidate.queueItemId === failed.activeItemId)
              ?.testCaseId
          : undefined,
        error: message
      })
    );
  }
  if (failed.status === 'completed') {
    const releaseReason: RoverLeaseReleaseReason = message
      .toLowerCase()
      .includes('bound browser tab')
      ? 'bound_tab_unavailable'
      : 'terminal_error';
    await finalizeManagedQueue(failed, {
      outcome: itemOutcome === 'incomplete' ? 'incomplete' : 'error',
      releaseReason
    });
    return;
  }
  if (failed.status === 'running') {
    if (failed.newConversationBetweenItems) await startQueueConversation(failed);
    await runQueueItem(failed);
  }
}

function isProviderReadinessError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('was not ready on the active tab') ||
    message.includes('is not matched by the active browser tab')
  );
}

export async function deferQueueItem(queue: RoverQueueState, error: unknown): Promise<void> {
  const message = errorMessage(error);
  if (queue.leaseId) {
    const released = clearLease(queue);
    const replacement = {
      ...createQueue(
        released.origin,
        released.provider,
        released.newConversationBetweenItems,
        new Date().toISOString()
      ),
      queueId: queue.queueId,
      recentHistory: released.recentHistory
    };
    await persistLeaseRelease(queue, 'provider_unavailable', false, replacement);
    debugLog('released managed assignment while waiting for provider', {
      queueId: queue.queueId,
      scenarioId: queue.items.find((item) => item.queueItemId === queue.activeItemId)?.testCaseId,
      error: message
    });
    return;
  }
  const deferred: RoverQueueState = {
    ...queue,
    status: 'running',
    error: { stage: 'browser', message: `Waiting for matching provider page. ${message}` },
    items: queue.items.map((item) =>
      item.queueItemId === queue.activeItemId
        ? {
            ...item,
            status: 'queued' as const,
            error: undefined,
            requestId: undefined,
            sessionId: undefined,
            startedAt: undefined
          }
        : item
    ),
    updatedAt: new Date().toISOString()
  };
  await saveQueue(deferred);
  const item = deferred.items.find((candidate) => candidate.queueItemId === deferred.activeItemId);
  if (item) sendScenarioStatus(deferred, item);
  debugLog('queue item deferred until provider is ready', {
    queueId: queue.queueId,
    scenarioId: item?.testCaseId,
    error: message
  });
}

export async function runQueueItem(queue: RoverQueueState): Promise<void> {
  const item = queue.items.find((candidate) => candidate.queueItemId === queue.activeItemId);
  if (!item || typeof queue.tabId !== 'number') return;
  if (item.cancelRequestedAt) return;
  try {
    debugLog('starting queue item', {
      queueId: queue.queueId,
      scenarioId: item.testCaseId,
      provider: queue.provider,
      tabId: queue.tabId
    });
    const client = new McplabClient(queue.origin);
    const boundProvider = await detectProvider(queue.tabId);
    const current = await activeTab();
    const activeProvider =
      typeof current?.id === 'number'
        ? current.id === queue.tabId
          ? boundProvider
          : await detectProvider(current.id)
        : undefined;
    const executionTabId = selectMatchingExecutionTab(
      queue.provider,
      { id: queue.tabId, provider: boundProvider },
      typeof current?.id === 'number' ? { id: current.id, provider: activeProvider } : undefined
    );
    if (executionTabId === undefined)
      throw new Error(`Browser provider '${queue.provider}' was not ready on the active tab.`);
    if (
      executionTabId !== queue.tabId &&
      (queue.leaseState === 'accepted' || queue.leaseState === 'running')
    ) {
      throw new Error(
        `Bound browser tab ${queue.tabId} is no longer available for provider '${queue.provider}'.`
      );
    }
    if (
      executionTabId !== queue.tabId &&
      queue.leaseState !== 'accepted' &&
      queue.leaseState !== 'running'
    ) {
      debugLog('rebinding queue to matching active tab', {
        queueId: queue.queueId,
        provider: queue.provider,
        previousTabId: queue.tabId,
        tabId: executionTabId
      });
      queue = { ...queue, tabId: executionTabId };
    }
    if (!isBuiltInProvider(queue.provider)) {
      const profile = (await client.listBrowserProviders()).find(
        (candidate) => candidate.id === queue.provider
      );
      if (!profile)
        throw new Error(
          `Learned browser provider '${queue.provider}' is no longer available in MCPLab.`
        );
    }
    await waitForProviderReady(executionTabId, queue.provider);
    const session = item.sessionId
      ? await client.get(item.sessionId)
      : await client.start(item.testCaseId, queue.provider, queue.evaluationRunId, {
          configPath: queue.sourceConfigPath,
          configName: queue.sourceConfigName,
          agentName: queue.sourceAgentName
        });
    const prompt = item.prompt || session.prompt;
    const requestId = crypto.randomUUID();
    const running: RoverQueueState = {
      ...queue,
      items: queue.items.map((candidate) =>
        candidate.queueItemId === item.queueItemId
          ? {
              ...candidate,
              prompt,
              sessionId: session.id,
              requestId,
              status: 'running' as const,
              startedAt: new Date().toISOString()
            }
          : candidate
      ),
      updatedAt: new Date().toISOString()
    };
    const latest = await getQueue();
    const latestItem = latest?.items.find(
      (candidate) => candidate.queueItemId === item.queueItemId
    );
    if (
      !latest ||
      latest.queueId !== queue.queueId ||
      latest.activeItemId !== item.queueItemId ||
      latestItem?.cancelRequestedAt
    )
      return;
    await saveQueue(running);
    sendScenarioStatus(
      running,
      running.items.find((candidate) => candidate.queueItemId === item.queueItemId)!
    );
    sendStage(queue, item.testCaseId, 'prompt_sent');
    await chrome.tabs.sendMessage(executionTabId, {
      type: 'ROVER_ASK',
      requestId,
      sessionId: session.id,
      queueId: queue.queueId,
      queueItemId: item.queueItemId,
      ...(queue.leaseId ? { leaseId: queue.leaseId } : {}),
      prompt
    });
    debugLog('prompt sent to content script', {
      queueId: queue.queueId,
      scenarioId: item.testCaseId,
      tabId: executionTabId
    });
    sendStage(queue, item.testCaseId, 'waiting_for_response');
  } catch (error) {
    const latest = await getQueue();
    if (
      !latest ||
      latest.queueId !== queue.queueId ||
      latest.status !== 'running' ||
      latest.activeItemId !== item.queueItemId
    ) {
      debugLog('ignored stale queue item error', {
        queueId: queue.queueId,
        scenarioId: item.testCaseId
      });
      return;
    }
    if (queue.evaluationRunId && isProviderReadinessError(error)) {
      await deferQueueItem(queue, error);
      return;
    }
    debugLog('queue item paused after error', {
      queueId: queue.queueId,
      scenarioId: item.testCaseId,
      error: error instanceof Error ? error.message : String(error)
    });
    if (queue.leaseId) await failManagedQueue(queue, error);
    else await pauseQueue(queue, error);
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

export async function waitForProviderReady(
  tabId: number,
  expectedProvider?: string
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const provider = await detectProvider(tabId);
    if (provider && (!expectedProvider || provider === expectedProvider)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Browser provider '${expectedProvider ?? 'unknown'}' was not ready on the active tab.`
  );
}

export async function startQueueConversation(queue: RoverQueueState): Promise<void> {
  if (typeof queue.tabId !== 'number') throw new Error('Queue browser tab is unavailable.');
  if (queue.provider === 'chatgpt-com') {
    const response = await chrome.tabs.sendMessage(queue.tabId, {
      type: 'ROVER_NEW_CHAT',
      requestId: crypto.randomUUID(),
      queueId: queue.queueId
    });
    if (!response?.ok)
      throw new Error(response?.error ?? 'Could not start a new ChatGPT conversation.');
    return;
  }
  if (queue.provider !== 'claude') {
    const profile = (await new McplabClient(queue.origin).listBrowserProviders()).find(
      (candidate) => candidate.id === queue.provider
    );
    if (!profile?.newConversation)
      throw new Error(`${queue.provider} does not have a learned new-conversation action.`);
    const response = await chrome.tabs.sendMessage(queue.tabId, {
      type: 'ROVER_NEW_CHAT',
      requestId: crypto.randomUUID(),
      queueId: queue.queueId
    });
    if (!response?.ok)
      throw new Error(response?.error ?? `Could not start a new ${profile.name} conversation.`);
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
