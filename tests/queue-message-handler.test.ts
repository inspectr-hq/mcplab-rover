import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeTab: vi.fn(),
  detectProvider: vi.fn(),
  resolveOrigin: vi.fn(),
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
  resolveOrigin: mocks.resolveOrigin,
  QUEUE_KEY: 'rover.queue',
  STATE_KEY: 'rover.run'
}));
vi.mock('../src/background/browser', () => ({
  activeTab: mocks.activeTab,
  detectProvider: mocks.detectProvider
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

import { createQueue, addQueueItem, startQueue, recordQueueItemOutcome } from '../src/queue/state';
import { serializeQueueOperation } from '../src/queue/operations';

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
    mocks.activeTab.mockResolvedValue({ id: 7 });
    mocks.detectProvider.mockResolvedValue('claude');
    mocks.resolveOrigin.mockResolvedValue('http://localhost:8787');
    mocks.getState.mockResolvedValue(null);
    mocks.saveQueue.mockResolvedValue(undefined);
    mocks.persistLeaseRelease.mockImplementation((queue) => queue);
  });

  it.each(['ROVER_QUEUE_CREATE', 'ROVER_QUEUE_SET_NEW_CHAT'] as const)(
    'serializes %s with concurrent Add',
    async (type) => {
      let persisted = createQueue('http://localhost:8787', 'claude', false, 'now');
      mocks.getQueue.mockImplementation(async () => persisted);
      let release!: () => void;
      const blocked = serializeQueueOperation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      const settingResponse = vi.fn();
      const addResponse = vi.fn();
      mocks.saveQueue.mockImplementation(async (queue) => {
        persisted = queue;
      });
      handleQueueMessage(
        type === 'ROVER_QUEUE_CREATE'
          ? { type, newConversationBetweenItems: true }
          : { type, enabled: true },
        settingResponse
      );
      handleQueueMessage(
        {
          type: 'ROVER_QUEUE_ADD',
          item: { id: 'new', name: 'New', prompt: '', assertionCount: 0 }
        },
        addResponse
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        expect(mocks.saveQueue).not.toHaveBeenCalled();
      } finally {
        release();
        await blocked;
      }
      await vi.waitFor(() =>
        expect(addResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
      );
      expect(persisted.items.map((item) => item.name)).toEqual(['New']);
      expect(persisted.newConversationBetweenItems).toBe(true);
    }
  );

  it.each(['draft', 'stopped'] as const)(
    'binds a %s local queue to the tab where Add was requested',
    async (status) => {
      mocks.getQueue.mockResolvedValue({
        ...createQueue('http://localhost:8787', 'claude', false, 'now'),
        status,
        tabId: 1
      });
      mocks.activeTab.mockResolvedValue({ id: 2 });
      const response = vi.fn();
      handleQueueMessage(
        {
          type: 'ROVER_QUEUE_ADD',
          item: { id: 'new', name: 'New', prompt: '', assertionCount: 0 }
        },
        response
      );
      await vi.waitFor(() =>
        expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
      );
      expect(mocks.saveQueue).toHaveBeenCalledWith(expect.objectContaining({ tabId: 2 }));
    }
  );

  it('does not add a local evaluation from a mismatched provider tab', async () => {
    mocks.getQueue.mockResolvedValue(createQueue('http://localhost:8787', 'claude', false, 'now'));
    mocks.detectProvider.mockResolvedValue('chatgpt-com');
    const response = vi.fn();
    handleQueueMessage(
      { type: 'ROVER_QUEUE_ADD', item: { id: 'new', name: 'New', prompt: '', assertionCount: 0 } },
      response
    );
    await vi.waitFor(() =>
      expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
    );
    expect(mocks.saveQueue).not.toHaveBeenCalled();
  });

  it.each(['completed', 'stopped'] as const)(
    'starts a new local queue on the detected provider after a %s assignment',
    async (status) => {
      const running = startQueue(
        addQueueItem(createQueue('http://localhost:8787', 'chatgpt-com', false, 'now'), {
          id: 'old',
          name: 'Old',
          prompt: '',
          assertionCount: 1
        }),
        'now'
      );
      const previous = {
        ...recordQueueItemOutcome(
          running,
          running.activeItemId!,
          'passed',
          { runId: 'saved' },
          'now'
        ),
        status,
        tabId: 11,
        evaluationRunId: 'managed-run',
        managedPhase: 'terminal' as const
      };
      mocks.getQueue.mockResolvedValue(previous);
      mocks.activeTab.mockResolvedValue({ id: 22 });
      const response = vi.fn();
      handleQueueMessage(
        {
          type: 'ROVER_QUEUE_ADD',
          item: { id: 'new', name: 'New', prompt: '', assertionCount: 1 }
        },
        response
      );
      await vi.waitFor(() =>
        expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
      );
      const saved = mocks.saveQueue.mock.calls[0][0];
      expect(saved).toMatchObject({
        status: 'draft',
        provider: 'claude',
        tabId: 22,
        origin: previous.origin,
        items: [expect.objectContaining({ testCaseId: 'new' })],
        recentHistory: { 'chatgpt-com': [expect.objectContaining({ runId: 'saved' })] }
      });
      expect(saved.queueId).not.toBe(previous.queueId);
      expect(saved.evaluationRunId).toBeUndefined();
      expect(saved.managedPhase).toBeUndefined();
      expect(mocks.persistLeaseRelease).not.toHaveBeenCalled();
    }
  );

  it('rejects Start on a closed assignment without saving or executing it', async () => {
    const running = startQueue(
      addQueueItem(
        addQueueItem(createQueue('http://localhost:8787', 'claude', false, 'now'), {
          id: 'first',
          name: 'First',
          prompt: '',
          assertionCount: 0
        }),
        { id: 'pending', name: 'Pending', prompt: '', assertionCount: 0 }
      ),
      'now'
    );
    mocks.getQueue.mockResolvedValue({
      ...running,
      status: 'stopped',
      activeItemId: undefined,
      evaluationRunId: 'closed-run',
      managedPhase: 'terminal'
    });
    const sendResponse = vi.fn();
    handleQueueMessage({ type: 'ROVER_QUEUE_START' }, sendResponse);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
    );
    expect(mocks.saveQueue).not.toHaveBeenCalled();
    expect(mocks.runQueueItem).not.toHaveBeenCalled();
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

  it('adds to a fresh local draft after a settled MCPLab assignment without releasing it again', async () => {
    const running = startQueue(
      addQueueItem(createQueue('http://localhost:8787', 'claude', false, 'now'), {
        id: 'old',
        name: 'Old',
        prompt: '',
        assertionCount: 0
      }),
      'now'
    );
    const completed = recordQueueItemOutcome(
      running,
      running.activeItemId!,
      'passed',
      { runId: 'saved' },
      'now'
    );
    mocks.getQueue.mockResolvedValue({
      ...completed,
      evaluationRunId: 'mcplab-run',
      managedPhase: 'terminal'
    });
    const sendResponse = vi.fn();
    handleQueueMessage(
      { type: 'ROVER_QUEUE_ADD', item: { id: 'new', name: 'New', prompt: '', assertionCount: 1 } },
      sendResponse
    );
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
    );
    const saved = mocks.saveQueue.mock.calls[0][0];
    expect(saved).toMatchObject({
      status: 'draft',
      items: [expect.objectContaining({ testCaseId: 'new' })],
      recentHistory: { claude: [expect.objectContaining({ runId: 'saved' })] }
    });
    expect(saved.evaluationRunId).toBeUndefined();
    expect(mocks.persistLeaseRelease).not.toHaveBeenCalled();
    expect(mocks.cancelActiveQueueItem).not.toHaveBeenCalled();
    expect(mocks.runQueueItem).not.toHaveBeenCalled();
  });

  it('serializes manual Add with assignment operations and reads the latest queue', async () => {
    vi.clearAllMocks();
    let finish!: () => void;
    const operation = serializeQueueOperation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const sendResponse = vi.fn();
    handleQueueMessage(
      { type: 'ROVER_QUEUE_ADD', item: { id: 'new', name: 'New', prompt: '', assertionCount: 1 } },
      sendResponse
    );
    expect(mocks.getQueue).not.toHaveBeenCalled();
    mocks.getQueue.mockResolvedValue({
      ...createQueue('http://localhost:8787', 'claude', false, 'now'),
      evaluationRunId: 'new-assignment',
      leaseId: 'lease',
      status: 'running'
    });
    finish();
    await operation;
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
    );
    expect(mocks.saveQueue).not.toHaveBeenCalled();
  });
});
