import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  getState: vi.fn(),
  getQueue: vi.fn(),
  saveQueue: vi.fn(),
  failManagedQueue: vi.fn(),
  pauseQueue: vi.fn()
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

import { handleResult, installMessageHandler } from '../src/background/messages';

describe('background message routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
      runtime: { onMessage: { addListener: mocks.addListener } }
    } as unknown as typeof chrome;
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
