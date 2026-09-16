import { describe, expect, it } from 'vitest';
import {
  addQueueItem,
  archiveCompletedQueueItems,
  createQueue,
  moveQueueItem,
  removeQueueItem,
  recordQueueItemOutcome,
  skipQueueItem,
  startQueue,
  stopScenario,
  stopQueue,
  type QueueCatalogItem
} from '../src/queue/state';

const alpha: QueueCatalogItem = { id: 'alpha', name: 'Alpha', prompt: 'A', assertionCount: 1 };
const beta: QueueCatalogItem = { id: 'beta', name: 'Beta', prompt: 'B', assertionCount: 2 };

describe('queue state', () => {
  it('archives completed items by provider and caps history at five', () => {
    const queue = createQueue('http://127.0.0.1:8787', 'claude', true, '2026-09-11T00:00:00.000Z');
    const items = Array.from({ length: 7 }, (_, index) => ({
      queueItemId: `item-${index}`,
      testCaseId: `case-${index}`,
      id: `case-${index}`,
      name: `Case ${index}`,
      prompt: '',
      assertionCount: 0,
      status: 'passed' as const
    }));
    const archived = archiveCompletedQueueItems({ ...queue, items });
    expect(archived.recentHistory?.claude.map((item) => item.queueItemId)).toEqual([
      'item-0',
      'item-1',
      'item-2',
      'item-3',
      'item-4'
    ]);
  });

  it('does not archive queued or running items', () => {
    const queue = createQueue('http://127.0.0.1:8787', 'claude', true, '2026-09-11T00:00:00.000Z');
    const item = {
      queueItemId: 'item-1',
      testCaseId: 'case-1',
      id: 'case-1',
      name: 'Case',
      prompt: '',
      assertionCount: 0,
      status: 'running' as const
    };
    const withItem = { ...queue, items: [item] };
    expect(archiveCompletedQueueItems(withItem)).toEqual(withItem);
  });

  it('archives an item as soon as its outcome is recorded', () => {
    let queue = createQueue('http://127.0.0.1:8787', 'claude', true, '2026-09-11T00:00:00.000Z');
    queue = addQueueItem(queue, alpha);
    queue = startQueue(queue, '2026-09-11T00:01:00.000Z');
    const completed = recordQueueItemOutcome(
      queue,
      queue.activeItemId!,
      'passed',
      {},
      '2026-09-11T00:02:00.000Z'
    );
    expect(completed.recentHistory?.claude[0]?.testCaseId).toBe('alpha');
  });
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
    let queue = createQueue(
      'http://127.0.0.1:8787',
      'trendminer',
      true,
      '2026-09-09T10:00:00.000Z'
    );
    queue = addQueueItem(addQueueItem(queue, alpha), beta);
    queue = startQueue(queue, '2026-09-09T10:01:00.000Z');
    const first = queue.items[0]!.queueItemId;
    queue = recordQueueItemOutcome(
      queue,
      first,
      'failed',
      { runId: 'run-1' },
      '2026-09-09T10:02:00.000Z'
    );
    expect(queue.status).toBe('running');
    expect(queue.activeItemId).toBe(queue.items[1]!.queueItemId);
    queue = recordQueueItemOutcome(
      queue,
      queue.items[1]!.queueItemId,
      'incomplete',
      { runId: 'run-2' },
      '2026-09-09T10:03:00.000Z'
    );
    expect(queue.status).toBe('completed');
    expect(queue.items.map((item) => item.status)).toEqual(['failed', 'incomplete']);
  });

  it('pauses for a browser failure and supports skip and stop', () => {
    let queue = startQueue(
      addQueueItem(
        createQueue('http://127.0.0.1:8787', 'claude', false, '2026-09-09T10:00:00.000Z'),
        alpha
      ),
      '2026-09-09T10:01:00.000Z'
    );
    queue = {
      ...queue,
      status: 'paused',
      error: { stage: 'browser', message: 'Composer missing' }
    };
    queue = skipQueueItem(queue, queue.activeItemId!, '2026-09-09T10:02:00.000Z');
    expect(queue.items[0]?.status).toBe('skipped');
    expect(queue.status).toBe('completed');
    queue = stopQueue(queue, '2026-09-09T10:03:00.000Z');
    expect(queue.status).toBe('stopped');
  });

  it('rejects skipping without the active queue item', () => {
    let queue = startQueue(
      addQueueItem(
        createQueue('http://127.0.0.1:8787', 'claude', false, '2026-09-09T10:00:00.000Z'),
        alpha
      ),
      '2026-09-09T10:01:00.000Z'
    );
    queue = {
      ...queue,
      status: 'paused',
      error: { stage: 'browser', message: 'Composer missing' }
    };

    expect(() => skipQueueItem(queue, '', '2026-09-09T10:02:00.000Z')).toThrow('active');
    expect(() =>
      skipQueueItem(
        { ...queue, activeItemId: undefined },
        undefined as unknown as string,
        '2026-09-09T10:02:00.000Z'
      )
    ).toThrow('active');
  });

  it('removes only queued items', () => {
    let queue = addQueueItem(
      addQueueItem(
        createQueue('http://127.0.0.1:8787', 'claude', false, '2026-09-09T10:00:00.000Z'),
        alpha
      ),
      beta
    );
    queue = startQueue(queue, '2026-09-09T10:01:00.000Z');
    expect(() => removeQueueItem(queue, queue.activeItemId!)).toThrow('active');
    queue = removeQueueItem(queue, queue.items[1]!.queueItemId);
    expect(queue.items).toHaveLength(1);
  });

  it('allows a completed queue to be run again from the beginning', () => {
    let queue = createQueue('http://127.0.0.1:8787', 'claude', false, '2026-09-09T10:00:00.000Z');
    queue = addQueueItem(queue, alpha);
    queue = startQueue(queue, '2026-09-09T10:01:00.000Z');
    queue = recordQueueItemOutcome(
      queue,
      queue.activeItemId!,
      'passed',
      { runId: 'run-1' },
      '2026-09-09T10:02:00.000Z'
    );
    const restarted = startQueue(queue, '2026-09-09T10:03:00.000Z');
    expect(restarted.status).toBe('running');
    expect(restarted.items[0]?.status).toBe('running');
    expect(restarted.items[0]?.runId).toBeUndefined();
  });

  it('stops a pending scenario without disturbing the active scenario', () => {
    let queue = createQueue('http://127.0.0.1:8787', 'claude', true, '2026-09-09T10:00:00.000Z');
    queue = addQueueItem(addQueueItem(queue, alpha), beta);
    queue = startQueue(queue, '2026-09-09T10:01:00.000Z');
    const pendingId = queue.items[1]!.queueItemId;

    const stopped = stopScenario(queue, 'beta', '2026-09-09T10:02:00.000Z');

    expect(stopped.activeItemId).toBe(queue.activeItemId);
    expect(stopped.status).toBe('running');
    expect(stopped.items[1]).toMatchObject({
      testCaseId: 'beta',
      status: 'stopped',
      completedAt: '2026-09-09T10:02:00.000Z'
    });
    expect(stopped.items[1]!.queueItemId).toBe(pendingId);
  });

  it('stops the active scenario and advances to the next queued scenario', () => {
    let queue = createQueue('http://127.0.0.1:8787', 'claude', true, '2026-09-09T10:00:00.000Z');
    queue = addQueueItem(addQueueItem(queue, alpha), beta);
    queue = startQueue(queue, '2026-09-09T10:01:00.000Z');

    const stopped = stopScenario(queue, 'alpha', '2026-09-09T10:02:00.000Z');

    expect(stopped.status).toBe('running');
    expect(stopped.activeItemId).toBe(stopped.items[1]!.queueItemId);
    expect(stopped.newConversationBetweenItems).toBe(true);
    expect(stopped.items.map((item) => item.status)).toEqual(['stopped', 'queued']);
  });

  it('preserves completed scenarios and is idempotent for stopped scenarios', () => {
    let queue = createQueue('http://127.0.0.1:8787', 'claude', false, '2026-09-09T10:00:00.000Z');
    queue = addQueueItem(addQueueItem(queue, alpha), beta);
    queue = startQueue(queue, '2026-09-09T10:01:00.000Z');
    queue = recordQueueItemOutcome(
      queue,
      queue.activeItemId!,
      'passed',
      { runId: 'run-1', text: 'done' },
      '2026-09-09T10:02:00.000Z'
    );

    const stopped = stopScenario(queue, 'beta', '2026-09-09T10:03:00.000Z');
    const repeated = stopScenario(stopped, 'beta', '2026-09-09T10:04:00.000Z');

    expect(repeated.items[0]).toMatchObject({ status: 'passed', runId: 'run-1', text: 'done' });
    expect(repeated.items[1]).toMatchObject({
      status: 'stopped',
      completedAt: '2026-09-09T10:03:00.000Z'
    });
  });

  it('stops the active duplicate instead of an earlier completed duplicate', () => {
    let queue = createQueue('http://127.0.0.1:8787', 'claude', false, '2026-09-09T10:00:00.000Z');
    queue = addQueueItem(addQueueItem(queue, alpha), alpha);
    queue = startQueue(queue, '2026-09-09T10:01:00.000Z');
    queue = recordQueueItemOutcome(
      queue,
      queue.activeItemId!,
      'passed',
      { runId: 'run-1' },
      '2026-09-09T10:02:00.000Z'
    );

    const stopped = stopScenario(queue, 'alpha', '2026-09-09T10:03:00.000Z');

    expect(stopped.items.map((item) => item.status)).toEqual(['passed', 'stopped']);
  });

  it('marks active items stopped when the whole queue is stopped', () => {
    let queue = createQueue('http://127.0.0.1:8787', 'claude', false, '2026-09-09T10:00:00.000Z');
    queue = startQueue(addQueueItem(queue, alpha), '2026-09-09T10:01:00.000Z');

    const stopped = stopQueue(queue, '2026-09-09T10:02:00.000Z');

    expect(stopped.items[0]?.status).toBe('stopped');
  });

  it('preserves lease metadata through queue transitions and clears it only when the caller does so', () => {
    let queue = createQueue('http://127.0.0.1:8787', 'claude', false, '2026-09-09T10:00:00.000Z');
    queue = addQueueItem(queue, alpha);
    queue = {
      ...startQueue(queue, '2026-09-09T10:01:00.000Z'),
      leaseId: 'lease-1',
      leaseExpiresAt: '2026-09-09T10:01:30.000Z',
      leaseState: 'running'
    };

    const stopped = stopQueue(queue, '2026-09-09T10:02:00.000Z');
    expect(stopped).toMatchObject({ leaseId: 'lease-1', leaseState: 'running' });
    expect(stopped.items[0]?.status).toBe('stopped');
  });
});
