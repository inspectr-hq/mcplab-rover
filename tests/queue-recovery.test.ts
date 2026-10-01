import { describe, expect, it } from 'vitest';
import { queueNeedsResume } from '../src/queue/recovery';

describe('queue recovery', () => {
  it('resumes a running queue whose active item is still queued', () => {
    expect(
      queueNeedsResume({
        status: 'running',
        activeItemId: 'item-1',
        items: [{ queueItemId: 'item-1', status: 'queued' }]
      })
    ).toBe(true);
  });

  it('does not replay an item that is already running or terminal', () => {
    expect(
      queueNeedsResume({
        status: 'running',
        activeItemId: 'item-1',
        items: [{ queueItemId: 'item-1', status: 'running' }]
      })
    ).toBe(false);
    expect(
      queueNeedsResume({
        status: 'paused',
        activeItemId: 'item-1',
        items: [{ queueItemId: 'item-1', status: 'queued' }]
      })
    ).toBe(false);
  });
});
