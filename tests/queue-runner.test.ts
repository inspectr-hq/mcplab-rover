import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  socket: null as { readyState: number; send: ReturnType<typeof vi.fn> } | null,
  saveQueue: vi.fn(),
  persistLeaseRelease: vi.fn()
}));

vi.mock('../src/background/lease-transport', () => ({
  currentSocket: () => mocks.socket,
  clearLease: (queue: Record<string, unknown>) => {
    const {
      leaseId: _leaseId,
      leaseState: _leaseState,
      leaseExpiresAt: _leaseExpiresAt,
      ...cleared
    } = queue;
    return cleared;
  },
  persistLeaseRelease: mocks.persistLeaseRelease
}));
vi.mock('../src/background/store', () => ({ getQueue: vi.fn(), saveQueue: mocks.saveQueue }));

import { deferQueueItem, finalizeManagedQueue, pauseQueue } from '../src/background/queue-runner';

describe('server assignment failure handling', () => {
  it('persists finalizing before sending a connected terminal completion', async () => {
    (globalThis as typeof globalThis & { WebSocket: unknown }).WebSocket = {
      OPEN: 1
    } as unknown as typeof WebSocket;
    mocks.socket = { readyState: 1, send: vi.fn() };
    mocks.saveQueue.mockResolvedValue(undefined);
    const queue = {
      queueId: 'job-finalizing',
      mode: 'queue' as const,
      origin: 'http://127.0.0.1:8787',
      provider: 'claude',
      evaluationRunId: 'run-1',
      leaseId: 'lease-1',
      leaseState: 'running' as const,
      managedPhase: 'running' as const,
      newConversationBetweenItems: true,
      status: 'running' as const,
      activeItemId: 'item-1',
      items: [
        {
          queueItemId: 'item-1',
          testCaseId: 'scenario-1',
          id: 'scenario-1',
          name: 'Scenario 1',
          prompt: 'Hi',
          assertionCount: 0,
          status: 'error' as const
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await finalizeManagedQueue(queue, { outcome: 'error', releaseReason: 'terminal_error' });

    expect(mocks.saveQueue).toHaveBeenCalledWith(
      expect.objectContaining({ managedPhase: 'finalizing' })
    );
    expect(mocks.socket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"complete"'));
  });

  it('pauses a failed server assignment without completing it', async () => {
    (globalThis as typeof globalThis & { WebSocket: unknown }).WebSocket = {
      OPEN: 1
    } as unknown as typeof WebSocket;
    mocks.socket = { readyState: 1, send: vi.fn() };
    mocks.saveQueue.mockResolvedValue(undefined);
    const queue = {
      queueId: 'job-1',
      mode: 'queue' as const,
      origin: 'http://127.0.0.1:8787',
      provider: 'chatgpt-com',
      evaluationRunId: 'run-1',
      newConversationBetweenItems: true,
      status: 'running' as const,
      activeItemId: 'item-1',
      items: [
        {
          queueItemId: 'item-1',
          testCaseId: 'scenario-1',
          id: 'scenario-1',
          name: 'Scenario 1',
          prompt: 'Hi',
          assertionCount: 0,
          status: 'running' as const
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await pauseQueue(queue, new Error('Browser provider was not ready.'));

    expect(mocks.socket.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"scenario_status"')
    );
    expect(mocks.socket.send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"complete"')
    );
    expect(mocks.saveQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'paused',
        error: { stage: 'browser', message: 'Browser provider was not ready.' }
      })
    );
  });

  it('does not send a server completion for a local queue', async () => {
    mocks.socket = { readyState: 1, send: vi.fn() };
    const queue = {
      queueId: 'local-1',
      mode: 'queue' as const,
      origin: 'http://127.0.0.1:8787',
      provider: 'chatgpt-com',
      newConversationBetweenItems: true,
      status: 'running' as const,
      activeItemId: 'item-1',
      items: [
        {
          queueItemId: 'item-1',
          testCaseId: 'scenario-1',
          id: 'scenario-1',
          name: 'Scenario 1',
          prompt: 'Hi',
          assertionCount: 0,
          status: 'running' as const
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await pauseQueue(queue, new Error('Browser provider was not ready.'));

    expect(mocks.socket.send).toHaveBeenCalledTimes(1);
    expect(mocks.socket.send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"complete"')
    );
  });

  it('keeps a server assignment running while waiting for its provider page', async () => {
    mocks.socket = { readyState: 1, send: vi.fn() };
    const queue = {
      queueId: 'job-2',
      mode: 'queue' as const,
      origin: 'http://127.0.0.1:8787',
      provider: 'm365-cloud-microsoft',
      evaluationRunId: 'run-2',
      newConversationBetweenItems: true,
      status: 'running' as const,
      activeItemId: 'item-1',
      items: [
        {
          queueItemId: 'item-1',
          testCaseId: 'scenario-1',
          id: 'scenario-1',
          name: 'Scenario 1',
          prompt: 'Hi',
          assertionCount: 0,
          status: 'running' as const
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await deferQueueItem(queue, new Error('Browser provider was not ready on the active tab.'));

    expect(mocks.saveQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'running',
        activeItemId: 'item-1',
        items: [expect.objectContaining({ status: 'queued' })]
      })
    );
    expect(mocks.socket.send).toHaveBeenCalledWith(expect.stringContaining('"status":"queued"'));
  });
  it('preserves the leased job id when deferring offline', async () => {
    mocks.socket = null;
    const queue = {
      queueId: 'job-offline',
      mode: 'queue' as const,
      origin: 'http://127.0.0.1:8787',
      provider: 'm365-cloud-microsoft',
      evaluationRunId: 'run-offline',
      leaseId: 'lease-offline',
      leaseState: 'running' as const,
      leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      newConversationBetweenItems: true,
      status: 'running' as const,
      activeItemId: 'item-1',
      items: [
        {
          queueItemId: 'item-1',
          testCaseId: 'scenario-1',
          id: 'scenario-1',
          name: 'Scenario 1',
          prompt: 'Hi',
          assertionCount: 0,
          status: 'running' as const
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await deferQueueItem(queue, new Error('Browser provider was not ready on the active tab.'));

    expect(mocks.persistLeaseRelease).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: 'job-offline', leaseId: 'lease-offline' }),
      'provider_unavailable',
      false,
      expect.objectContaining({ queueId: 'job-offline', provider: 'm365-cloud-microsoft' })
    );
  });
});
