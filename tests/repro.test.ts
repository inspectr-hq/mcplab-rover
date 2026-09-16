import { describe, expect, it } from 'vitest';
import { addQueueItem, createQueue, startQueue } from '../src/queue/state';

describe('repro double start', () => {
  it('calling startQueue while already running orphans the active item', () => {
    let queue = createQueue('http://127.0.0.1:8787', 'claude', false, '2026-09-09T10:00:00.000Z');
    queue = addQueueItem(queue, { id: 'alpha', name: 'Alpha', prompt: 'A', assertionCount: 1 });
    queue = addQueueItem(queue, { id: 'beta', name: 'Beta', prompt: 'B', assertionCount: 1 });
    queue = startQueue(queue, '2026-09-09T10:01:00.000Z');
    console.log(
      'after first start',
      JSON.stringify(
        queue.items.map((i) => ({ id: i.testCaseId, status: i.status })),
        null,
        2
      ),
      'active',
      queue.activeItemId
    );
    // simulate a second START call arriving (race / double click) while queue is already running
    const again = startQueue(queue, '2026-09-09T10:01:05.000Z');
    console.log(
      'after second start',
      JSON.stringify(
        again.items.map((i) => ({ id: i.testCaseId, status: i.status })),
        null,
        2
      ),
      'active',
      again.activeItemId
    );
    expect(again.items.filter((i) => i.status === 'running').length).toBe(1); // will this fail?
  });
});
