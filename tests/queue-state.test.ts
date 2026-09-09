import { describe, expect, it } from 'vitest';
import {
  addQueueItem,
  createQueue,
  moveQueueItem,
  removeQueueItem,
  recordQueueItemOutcome,
  skipQueueItem,
  startQueue,
  stopQueue,
  type QueueCatalogItem
} from '../src/queue/state';

const alpha: QueueCatalogItem = { id: 'alpha', name: 'Alpha', prompt: 'A', assertionCount: 1 };
const beta: QueueCatalogItem = { id: 'beta', name: 'Beta', prompt: 'B', assertionCount: 2 };

describe('queue state', () => {
  it('supports duplicate evaluations and explicit ordering', () => {
    let queue = createQueue('http://127.0.0.1:8787', 'claude', false, '2026-09-09T10:00:00.000Z');
    queue = addQueueItem(queue, alpha);
    queue = addQueueItem(queue, beta);
    queue = addQueueItem(queue, alpha);
    expect(queue.items.map((item) => item.testCaseId)).toEqual(['alpha', 'beta', 'alpha']);
    queue = moveQueueItem(queue, queue.items[2]!.queueItemId, 'up');
    expect(queue.items.map((item) => item.testCaseId)).toEqual(['alpha', 'alpha', 'beta']);
  });

  it('advances after evaluated outcomes and completes after the final item', () => {
    let queue = createQueue('http://127.0.0.1:8787', 'trendminer', true, '2026-09-09T10:00:00.000Z');
    queue = addQueueItem(addQueueItem(queue, alpha), beta);
    queue = startQueue(queue, '2026-09-09T10:01:00.000Z');
    const first = queue.items[0]!.queueItemId;
    queue = recordQueueItemOutcome(queue, first, 'failed', { runId: 'run-1' }, '2026-09-09T10:02:00.000Z');
    expect(queue.status).toBe('running');
    expect(queue.activeItemId).toBe(queue.items[1]!.queueItemId);
    queue = recordQueueItemOutcome(queue, queue.items[1]!.queueItemId, 'incomplete', { runId: 'run-2' }, '2026-09-09T10:03:00.000Z');
    expect(queue.status).toBe('completed');
    expect(queue.items.map((item) => item.status)).toEqual(['failed', 'incomplete']);
  });

  it('pauses for a browser failure and supports skip and stop', () => {
    let queue = startQueue(addQueueItem(createQueue('http://127.0.0.1:8787', 'claude', false, '2026-09-09T10:00:00.000Z'), alpha), '2026-09-09T10:01:00.000Z');
    queue = { ...queue, status: 'paused', error: { stage: 'browser', message: 'Composer missing' } };
    queue = skipQueueItem(queue, queue.activeItemId!, '2026-09-09T10:02:00.000Z');
    expect(queue.items[0]?.status).toBe('skipped');
    expect(queue.status).toBe('completed');
    queue = stopQueue(queue, '2026-09-09T10:03:00.000Z');
    expect(queue.status).toBe('stopped');
  });

  it('removes only queued items', () => {
    let queue = addQueueItem(addQueueItem(createQueue('http://127.0.0.1:8787', 'claude', false, '2026-09-09T10:00:00.000Z'), alpha), beta);
    queue = startQueue(queue, '2026-09-09T10:01:00.000Z');
    expect(() => removeQueueItem(queue, queue.activeItemId!)).toThrow('active');
    queue = removeQueueItem(queue, queue.items[1]!.queueItemId);
    expect(queue.items).toHaveLength(1);
  });

  it('allows a completed queue to be run again from the beginning', () => {
    let queue = createQueue('http://127.0.0.1:8787', 'claude', false, '2026-09-09T10:00:00.000Z');
    queue = addQueueItem(queue, alpha);
    queue = startQueue(queue, '2026-09-09T10:01:00.000Z');
    queue = recordQueueItemOutcome(queue, queue.activeItemId!, 'passed', { runId: 'run-1' }, '2026-09-09T10:02:00.000Z');
    const restarted = startQueue(queue, '2026-09-09T10:03:00.000Z');
    expect(restarted.status).toBe('running');
    expect(restarted.items[0]?.status).toBe('running');
    expect(restarted.items[0]?.runId).toBeUndefined();
  });
});
