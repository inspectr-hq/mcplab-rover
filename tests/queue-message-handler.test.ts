import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getQueue: vi.fn(),
  getState: vi.fn(),
  saveQueue: vi.fn(),
  waitingForMatching: vi.fn(() => [{ jobId: 'job-1', provider: 'claude', position: 1 }]),
  cancelActiveQueueItem: vi.fn(),
  runQueueItem: vi.fn(),
  persistLeaseRelease: vi.fn((queue) => queue),
  currentSocket: vi.fn(() => ({ readyState: 1 }))
}));

vi.mock('../src/background/store', () => ({
  getQueue: mocks.getQueue,
  getState: mocks.getState,
  saveQueue: mocks.saveQueue,
  resolveOrigin: vi.fn(),
  QUEUE_KEY: 'rover.queue',
  STATE_KEY: 'rover.run'
}));
vi.mock('../src/background/socket', () => ({ waitingForMatching: mocks.waitingForMatching }));
vi.mock('../src/background/queue-runner', () => ({
  cancelActiveQueueItem: mocks.cancelActiveQueueItem,
  runQueueItem: mocks.runQueueItem
}));
vi.mock('../src/background/lease-transport', () => ({
  currentSocket: mocks.currentSocket,
  persistLeaseRelease: mocks.persistLeaseRelease
}));

import { handleQueueMessage } from '../src/background/queue-message-handler';

describe('queue message handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { WebSocket: unknown }).WebSocket = {
      OPEN: 1
    } as unknown as typeof WebSocket;
    (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
      storage: { session: { remove: vi.fn() } }
    } as unknown as typeof chrome;
    mocks.getState.mockResolvedValue(null);
    mocks.saveQueue.mockResolvedValue(undefined);
    mocks.persistLeaseRelease.mockImplementation((queue) => queue);
  });

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
    expect(sendResponse).toHaveBeenCalledWith([
      { jobId: 'job-1', provider: 'claude', position: 1 }
    ]);
    expect(mocks.getQueue).not.toHaveBeenCalled();
  });

  it('persists history dismissal without stopping or releasing an assignment', async () => {
    const queue = {
      queueId: 'queue-1',
      mode: 'queue',
      origin: 'http://localhost:8787',
      provider: 'claude',
      newConversationBetweenItems: false,
      status: 'completed',
      createdAt: 'now',
      updatedAt: 'now',
      leaseId: 'lease-1',
      managedPhase: 'waiting_ack',
      items: [
        {
          queueItemId: 'finished',
          testCaseId: 'case',
          id: 'case',
          name: 'Case',
          prompt: '',
          assertionCount: 0,
          status: 'passed'
        }
      ]
    };
    mocks.getQueue.mockResolvedValue(queue);
    const sendResponse = vi.fn();
    handleQueueMessage(
      { type: 'ROVER_QUEUE_DISMISS_HISTORY', provider: 'claude', queueItemId: 'finished' },
      sendResponse
    );
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
    );
    expect(mocks.saveQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseId: 'lease-1',
        managedPhase: 'waiting_ack',
        recentHistory: { claude: [] }
      })
    );
    expect(mocks.cancelActiveQueueItem).not.toHaveBeenCalled();
    expect(mocks.persistLeaseRelease).not.toHaveBeenCalled();
  });

  it('starts a draft queue and dispatches its first item', async () => {
    const queue = {
      queueId: 'queue-1',
      mode: 'queue',
      origin: 'http://127.0.0.1:8787',
      provider: 'claude',
      newConversationBetweenItems: false,
      status: 'draft',
      items: [
        {
          queueItemId: 'item-1',
          testCaseId: 'case-1',
          id: 'case-1',
          name: 'Case',
          prompt: 'Hello',
          assertionCount: 0,
          status: 'queued'
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    mocks.getQueue.mockResolvedValue(queue);
    const sendResponse = vi.fn();
    handleQueueMessage({ type: 'ROVER_QUEUE_START' }, sendResponse);
    await vi.waitFor(() => expect(mocks.runQueueItem).toHaveBeenCalled());
    expect(mocks.saveQueue).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }));
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('stops a running queue and persists its release', async () => {
    const queue = {
      queueId: 'queue-1',
      mode: 'queue',
      origin: 'http://127.0.0.1:8787',
      provider: 'claude',
      newConversationBetweenItems: false,
      status: 'running',
      activeItemId: 'item-1',
      leaseId: 'lease-1',
      items: [
        {
          queueItemId: 'item-1',
          testCaseId: 'case-1',
          id: 'case-1',
          name: 'Case',
          prompt: 'Hello',
          assertionCount: 0,
          status: 'running'
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    mocks.getQueue.mockResolvedValue(queue);
    const sendResponse = vi.fn();
    handleQueueMessage({ type: 'ROVER_QUEUE_STOP' }, sendResponse);
    await vi.waitFor(() => expect(mocks.persistLeaseRelease).toHaveBeenCalled());
    expect(mocks.cancelActiveQueueItem).toHaveBeenCalledWith(queue);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('clears a queue after persisting its stopped lease release', async () => {
    const queue = {
      queueId: 'queue-1',
      mode: 'queue',
      origin: 'http://127.0.0.1:8787',
      provider: 'claude',
      newConversationBetweenItems: false,
      status: 'stopped',
      leaseId: 'lease-1',
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    mocks.getQueue.mockResolvedValue(queue);
    const sendResponse = vi.fn();
    handleQueueMessage({ type: 'ROVER_QUEUE_CLEAR' }, sendResponse);
    await vi.waitFor(() =>
      expect(mocks.persistLeaseRelease).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'stopped' }),
        'stopped',
        true
      )
    );
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});
