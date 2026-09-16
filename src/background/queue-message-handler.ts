import type { ExtensionMessage } from '../contracts';
import {
  addQueueItem,
  moveQueueItem,
  removeQueueItem,
  skipQueueItem,
  startQueue,
  stopQueue,
  type RoverQueueState
} from '../queue/state';
import { serializeQueueOperation } from '../queue/operations';
import { activeTab, detectProvider } from './browser';
import { errorMessage } from './errors';
import { cancelActiveQueueItem, runQueueItem } from './queue-runner';
import { createQueueForMessage } from './queue-message-helpers';
import { currentSocket, persistLeaseRelease } from './lease-transport';
import { getQueue, getState, QUEUE_KEY, resolveOrigin, saveQueue, STATE_KEY } from './store';
import { waitingForMatching } from './socket';

type QueueMessage = Extract<ExtensionMessage, { type: `ROVER_QUEUE_${string}` }>;

function assertNever(value: never): never {
  throw new Error(`Unhandled queue message: ${(value as { type: string }).type}`);
}

function respond<T>(
  sendResponse: (response: T | { ok: false; error: string }) => void,
  work: () => Promise<T>
): true {
  void work()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
}

export function handleQueueMessage(
  message: QueueMessage,
  sendResponse: (response: unknown) => void
): true {
  if (message.type === 'ROVER_QUEUE_GET') {
    void getQueue().then(sendResponse);
    return true;
  }
  if (message.type === 'ROVER_QUEUE_WAITING') {
    sendResponse(waitingForMatching());
    return true;
  }
  if (message.type === 'ROVER_QUEUE_CLEAR') {
    return respond(sendResponse, async () => {
      const queue = await getQueue();
      console.info('[Rover debug] queue clear requested', {
        queueId: queue?.queueId,
        activeItemId: queue?.activeItemId
      });
      if (queue) {
        await cancelActiveQueueItem(queue);
        await persistLeaseRelease({ ...queue, status: 'stopped' }, 'stopped', true);
      }
      if (currentSocket()?.readyState === WebSocket.OPEN || !queue?.leaseId)
        await chrome.storage.session.remove(QUEUE_KEY);
      return { ok: true };
    });
  }
  if (message.type === 'ROVER_QUEUE_CREATE') {
    return respond(sendResponse, async () => {
      const liveState = await getState();
      if (liveState && ['ready', 'running', 'manual', 'evaluating'].includes(liveState.status))
        throw new Error('Finish or stop the active Live Test before starting a queue.');
      const origin = await resolveOrigin(message.origin);
      const tab = await activeTab();
      const provider = typeof tab?.id === 'number' ? await detectProvider(tab.id) : undefined;
      if (!provider || typeof tab?.id !== 'number')
        throw new Error('Queue mode requires a supported or learned browser provider page.');
      const previous = await getQueue();
      const queue = {
        ...createQueueForMessage(origin, provider, message.newConversationBetweenItems),
        recentHistory: previous?.recentHistory,
        tabId: tab.id
      };
      await saveQueue(queue);
      await chrome.storage.session.remove(STATE_KEY);
      return { ok: true, queue };
    });
  }
  if (message.type === 'ROVER_QUEUE_SET_NEW_CHAT') {
    return respond(sendResponse, async () => {
      const queue = await getQueue();
      if (!queue || queue.status !== 'draft')
        throw new Error('Conversation setting can only change before the queue starts.');
      const next = {
        ...queue,
        newConversationBetweenItems: message.enabled,
        updatedAt: new Date().toISOString()
      };
      await saveQueue(next);
      return { ok: true, queue: next };
    });
  }
  if (
    message.type === 'ROVER_QUEUE_ADD' ||
    message.type === 'ROVER_QUEUE_REMOVE' ||
    message.type === 'ROVER_QUEUE_MOVE'
  ) {
    return respond(sendResponse, async () => {
      const queue = await getQueue();
      if (!queue) throw new Error('No queue has been created.');
      const next =
        message.type === 'ROVER_QUEUE_ADD'
          ? addQueueItem(queue, message.item)
          : message.type === 'ROVER_QUEUE_REMOVE'
            ? removeQueueItem(queue, message.queueItemId)
            : moveQueueItem(queue, message.queueItemId, message.direction);
      await saveQueue(next);
      return { ok: true, queue: next };
    });
  }
  if (message.type === 'ROVER_QUEUE_START') {
    void serializeQueueOperation(async () => {
      const liveState = await getState();
      if (liveState && ['ready', 'running', 'manual', 'evaluating'].includes(liveState.status))
        throw new Error('Finish or stop the active Live Test before starting a queue.');
      const queue = await getQueue();
      if (!queue) throw new Error('No queue has been created.');
      if (queue.status === 'running') {
        sendResponse({ ok: true, queue });
        return;
      }
      const started = startQueue(queue, new Date().toISOString());
      await saveQueue(started);
      sendResponse({ ok: true, queue: started });
      await runQueueItem(started);
    }).catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }
  if (message.type === 'ROVER_QUEUE_STOP' || message.type === 'ROVER_QUEUE_SKIP') {
    void serializeQueueOperation(async () => {
      const queue = await getQueue();
      if (!queue) throw new Error('No queue is active.');
      console.info('[Rover debug] queue control requested', {
        action: message.type,
        queueId: queue.queueId,
        activeItemId: queue.activeItemId
      });
      await cancelActiveQueueItem(queue);
      const next =
        message.type === 'ROVER_QUEUE_STOP'
          ? stopQueue(queue, new Date().toISOString())
          : skipQueueItem(queue, queue.activeItemId!, new Date().toISOString());
      const terminal = next.status === 'completed' || next.status === 'stopped';
      const persisted =
        terminal && next.leaseId ? await persistLeaseRelease(next, 'stopped') : next;
      if (!terminal || !next.leaseId) await saveQueue(persisted);
      sendResponse({ ok: true, queue: persisted });
      if (message.type === 'ROVER_QUEUE_SKIP' && next.status === 'running')
        await runQueueItem(next);
    }).catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }
  if (message.type === 'ROVER_QUEUE_RETRY') {
    void serializeQueueOperation(async () => {
      const queue = await getQueue();
      if (!queue || queue.status !== 'paused' || !queue.activeItemId)
        throw new Error('No paused queue item to retry.');
      const retrying: RoverQueueState = {
        ...queue,
        status: 'running',
        error: undefined,
        items: queue.items.map((item) =>
          item.queueItemId === queue.activeItemId ? { ...item, status: 'running' as const } : item
        ),
        updatedAt: new Date().toISOString()
      };
      await saveQueue(retrying);
      sendResponse({ ok: true, queue: retrying });
      await runQueueItem(retrying);
    }).catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }
  return assertNever(message);
}
