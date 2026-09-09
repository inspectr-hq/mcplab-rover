import type { CheckCounts, RunOutcome } from '../mcplab/types';
import type { ProviderId } from '../contracts';

export type QueueItemStatus = 'queued' | 'running' | 'evaluating' | 'passed' | 'failed' | 'incomplete' | 'skipped' | 'error';
export type QueueStatus = 'draft' | 'running' | 'paused' | 'completed' | 'stopped';

export interface QueueCatalogItem {
  id: string;
  name: string;
  prompt: string;
  assertionCount: number;
}

export interface QueueItemResult {
  runId?: string;
  resultUrl?: string;
  checkCounts?: CheckCounts;
  text?: string;
}

export interface RoverQueueItem extends QueueCatalogItem, QueueItemResult {
  queueItemId: string;
  testCaseId: string;
  status: QueueItemStatus;
  sessionId?: string;
  requestId?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface QueueFailure {
  stage: 'browser' | 'mcplab';
  message: string;
}

export interface RoverQueueState {
  queueId: string;
  mode: 'queue';
  origin: string;
  provider: ProviderId;
  tabId?: number;
  newConversationBetweenItems: boolean;
  status: QueueStatus;
  items: RoverQueueItem[];
  activeItemId?: string;
  error?: QueueFailure;
  createdAt: string;
  updatedAt: string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function updated(queue: RoverQueueState, patch: Partial<RoverQueueState>): RoverQueueState {
  return { ...queue, ...patch, updatedAt: new Date().toISOString() };
}

export function createQueue(origin: string, provider: ProviderId, newConversationBetweenItems: boolean, now: string): RoverQueueState {
  return {
    queueId: crypto.randomUUID(),
    mode: 'queue',
    origin,
    provider,
    newConversationBetweenItems,
    status: 'draft',
    items: [],
    createdAt: now,
    updatedAt: now
  };
}

export function addQueueItem(queue: RoverQueueState, catalog: QueueCatalogItem): RoverQueueState {
  if (queue.status !== 'draft') throw new Error('Queue can only be edited before it starts.');
  const item: RoverQueueItem = { ...clone(catalog), testCaseId: catalog.id, queueItemId: crypto.randomUUID(), status: 'queued' };
  return updated(queue, { items: [...queue.items, item] });
}

export function moveQueueItem(queue: RoverQueueState, queueItemId: string, direction: 'up' | 'down'): RoverQueueState {
  const index = queue.items.findIndex((item) => item.queueItemId === queueItemId);
  if (index < 0) throw new Error('Queue item not found.');
  if (queue.items[index]!.status !== 'queued') throw new Error('Cannot move an active queue item.');
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= queue.items.length) return queue;
  if (queue.items[target]!.status !== 'queued') return queue;
  const items = [...queue.items];
  [items[index], items[target]] = [items[target]!, items[index]!];
  return updated(queue, { items });
}

export function removeQueueItem(queue: RoverQueueState, queueItemId: string): RoverQueueState {
  const item = queue.items.find((candidate) => candidate.queueItemId === queueItemId);
  if (!item) throw new Error('Queue item not found.');
  if (item.status !== 'queued') throw new Error('Cannot remove an active queue item.');
  return updated(queue, { items: queue.items.filter((candidate) => candidate.queueItemId !== queueItemId) });
}

export function startQueue(queue: RoverQueueState, now: string): RoverQueueState {
  const restart = queue.status === 'completed' || queue.status === 'stopped';
  const candidates = restart
    ? queue.items.map((item) => ({ ...item, status: 'queued' as const, sessionId: undefined, requestId: undefined, startedAt: undefined, completedAt: undefined, runId: undefined, resultUrl: undefined, checkCounts: undefined, text: undefined }))
    : queue.items;
  const first = candidates.find((item) => item.status === 'queued');
  if (!first) throw new Error('Queue must contain at least one evaluation.');
  return updated(queue, {
    status: 'running',
    activeItemId: first.queueItemId,
    items: candidates.map((item) => item.queueItemId === first.queueItemId ? { ...item, status: 'running', startedAt: now } : item),
    error: undefined
  });
}

export function recordQueueItemOutcome(queue: RoverQueueState, queueItemId: string, outcome: RunOutcome, result: QueueItemResult, now: string): RoverQueueState {
  const item = queue.items.find((candidate) => candidate.queueItemId === queueItemId);
  if (!item) throw new Error('Queue item not found.');
  if (queue.activeItemId !== queueItemId) throw new Error('Queue item is not active.');
  const items = queue.items.map((candidate) => candidate.queueItemId === queueItemId
    ? { ...candidate, ...clone(result), status: outcome, completedAt: now }
    : candidate);
  const next = items.find((candidate) => candidate.status === 'queued');
  return updated(queue, next
    ? { items, activeItemId: next.queueItemId, error: undefined }
    : { items, activeItemId: undefined, status: 'completed', error: undefined });
}

export function skipQueueItem(queue: RoverQueueState, queueItemId: string, now: string): RoverQueueState {
  if (queue.activeItemId !== queueItemId) throw new Error('Queue item is not active.');
  const items = queue.items.map((item) => item.queueItemId === queueItemId ? { ...item, status: 'skipped' as const, completedAt: now } : item);
  const next = items.find((item) => item.status === 'queued');
  return updated(queue, next ? { items, status: 'running', activeItemId: next.queueItemId, error: undefined } : { items, status: 'completed', activeItemId: undefined, error: undefined });
}

export function stopQueue(queue: RoverQueueState, now: string): RoverQueueState {
  return updated(queue, { status: 'stopped', activeItemId: undefined, error: undefined, items: queue.items.map((item) => item.status === 'running' || item.status === 'evaluating' ? { ...item, status: 'error', completedAt: now } : item) });
}
