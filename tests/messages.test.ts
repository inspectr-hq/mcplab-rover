import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  getState: vi.fn(),
  getQueue: vi.fn(),
  saveQueue: vi.fn(),
  failManagedQueue: vi.fn(),
  pauseQueue: vi.fn(),
  complete: vi.fn(),
  socket: { readyState: 1, send: vi.fn() }
}));

vi.mock('../src/background/store', async () => {
  const actual =
    await vi.importActual<typeof import('../src/background/store')>('../src/background/store');
  return {
    ...actual,
    getState: mocks.getState,
    getQueue: mocks.getQueue,
    saveQueue: mocks.saveQueue
  };
});

vi.mock('../src/background/queue-runner', async () => {
  const actual = await vi.importActual<typeof import('../src/background/queue-runner')>(
    '../src/background/queue-runner'
  );
  return { ...actual, failManagedQueue: mocks.failManagedQueue, pauseQueue: mocks.pauseQueue };
});

vi.mock('../src/mcplab/api-client', () => ({
  McplabClient: vi.fn().mockImplementation(function () {
    return { complete: mocks.complete };
  })
}));

vi.mock('../src/background/lease-transport', async () => {
  const actual = await vi.importActual<typeof import('../src/background/lease-transport')>(
    '../src/background/lease-transport'
  );
  return { ...actual, currentSocket: () => mocks.socket };
});

import { handleResult, installMessageHandler } from '../src/background/messages';

describe('background message routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
      runtime: { onMessage: { addListener: mocks.addListener } }
    } as unknown as typeof chrome;
    (globalThis as typeof globalThis & { WebSocket: unknown }).WebSocket = {
      OPEN: 1
    } as unknown as typeof WebSocket;
    mocks.complete.mockResolvedValue({
      runId: 'run-1',
      outcome: 'failed',
      checkCounts: { passed: 0, failed: 1, not_evaluated: 0, total: 1 },
      resultUrl: '/results/run-1'
    });
  });

  it('ignores a stale queue result without mutating the queue', async () => {
    mocks.getQueue.mockResolvedValue({
      queueId: 'queue-1',
      activeItemId: 'item-1',
      items: [{ queueItemId: 'item-1', requestId: 'current', sessionId: 'session-1' }]
    });
    await handleResult({
      type: 'ROVER_RESULT',
      queueId: 'queue-1',
      queueItemId: 'item-1',
      requestId: 'stale',
      sessionId: 'session-1',
      result: { ok: true, text: 'old result' }
    });
    expect(mocks.saveQueue).not.toHaveBeenCalled();
  });

  it('routes a failed leased result through managed failure cleanup', async () => {
    const queue = {
      queueId: 'queue-1',
      activeItemId: 'item-1',
      leaseId: 'lease-1',
      items: [{ queueItemId: 'item-1', requestId: 'request-1', sessionId: 'session-1' }]
    };
    mocks.getQueue.mockResolvedValue(queue);
    await handleResult({
      type: 'ROVER_RESULT',
      queueId: 'queue-1',
      queueItemId: 'item-1',
      requestId: 'request-1',
      sessionId: 'session-1',
      leaseId: 'lease-1',
      result: { ok: false, error: 'agent failed' }
    });
    expect(mocks.failManagedQueue).toHaveBeenCalledWith(queue, expect.any(Error));
  });

  it('preserves incomplete capture codes for managed queue handling', async () => {
    const queue = {
      queueId: 'queue-1',
      activeItemId: 'item-1',
      leaseId: 'lease-1',
      items: [{ queueItemId: 'item-1', requestId: 'request-1', sessionId: 'session-1' }]
    };
    mocks.getQueue.mockResolvedValue(queue);
    await handleResult({
      type: 'ROVER_RESULT',
      queueId: 'queue-1',
      queueItemId: 'item-1',
      requestId: 'request-1',
      sessionId: 'session-1',
      leaseId: 'lease-1',
      result: { ok: false, error: 'Response capture incomplete', code: 'incomplete' }
    });
    expect(mocks.failManagedQueue).toHaveBeenCalledWith(
      queue,
      expect.objectContaining({ message: 'Response capture incomplete', code: 'incomplete' })
    );
  });

  it('does not report an evaluation failure as a Rover execution error', async () => {
    const queue = {
      queueId: 'queue-1',
      origin: 'http://127.0.0.1:8787',
      provider: 'trendminer',
      status: 'running',
      mode: 'queue',
      newConversationBetweenItems: false,
      activeItemId: 'item-1',
      leaseId: 'lease-1',
      items: [
        {
          queueItemId: 'item-1',
          testCaseId: 'case-1',
          id: 'case-1',
          name: 'Case 1',
          prompt: 'prompt',
          assertionCount: 1,
          requestId: 'request-1',
          sessionId: 'session-1',
          status: 'running',
          startedAt: new Date().toISOString()
        }
      ]
    };
    mocks.getQueue.mockResolvedValue(queue);
    await handleResult({
      type: 'ROVER_RESULT',
      queueId: 'queue-1',
      queueItemId: 'item-1',
      requestId: 'request-1',
      sessionId: 'session-1',
      leaseId: 'lease-1',
      result: { ok: true, text: 'answer' }
    });

    const progress = mocks.socket.send.mock.calls
      .map(([payload]) => JSON.parse(payload as string))
      .find((message) => message.type === 'progress');
    expect(progress).toBeDefined();
    expect(progress.error).toBeUndefined();
  });

  it('registers a runtime handler for state reads', async () => {
    const state = { status: 'ready' };
    mocks.getState.mockResolvedValue(state);
    installMessageHandler();
    const listener = mocks.addListener.mock.calls.at(-1)?.[0] as (
      message: unknown,
      sender: unknown,
      sendResponse: (value: unknown) => void
    ) => boolean;
    const sendResponse = vi.fn();

    expect(listener({ type: 'ROVER_GET_STATE' }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(state));
  });
});
