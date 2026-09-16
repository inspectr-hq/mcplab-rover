import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getQueue: vi.fn(),
  waitingForMatching: vi.fn(() => [{ jobId: 'job-1', provider: 'claude', position: 1 }])
}));

vi.mock('../src/background/store', () => ({ getQueue: mocks.getQueue }));
vi.mock('../src/background/socket', () => ({ waitingForMatching: mocks.waitingForMatching }));

import { handleQueueMessage } from '../src/background/queue-message-handler';

describe('queue message handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the persisted queue for queue reads', async () => {
    const queue = { queueId: 'queue-1' };
    mocks.getQueue.mockResolvedValue(queue);
    const sendResponse = vi.fn();

    expect(handleQueueMessage({ type: 'ROVER_QUEUE_GET' }, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(queue));
  });

  it('returns waiting assignments without touching queue state', () => {
    const sendResponse = vi.fn();

    expect(handleQueueMessage({ type: 'ROVER_QUEUE_WAITING' }, sendResponse)).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith([{ jobId: 'job-1', provider: 'claude', position: 1 }]);
    expect(mocks.getQueue).not.toHaveBeenCalled();
  });
});
