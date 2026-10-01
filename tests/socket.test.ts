import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeTab: vi.fn(),
  detectProvider: vi.fn(),
  getQueue: vi.fn(),
  saveQueue: vi.fn(),
  resolveOrigin: vi.fn(),
  waitForProviderReady: vi.fn(),
  runQueueItem: vi.fn(),
  startQueueConversation: vi.fn(),
  cancelActiveQueueItem: vi.fn()
}));

vi.mock('../src/background/browser', () => ({
  activeTab: mocks.activeTab,
  detectProvider: mocks.detectProvider
}));
vi.mock('../src/background/store', () => ({
  getQueue: mocks.getQueue,
  saveQueue: mocks.saveQueue,
  resolveOrigin: mocks.resolveOrigin,
  QUEUE_KEY: 'rover.queue'
}));
vi.mock('../src/background/queue-runner', () => ({
  cancelActiveQueueItem: mocks.cancelActiveQueueItem,
  failManagedQueue: vi.fn(),
  finalizeManagedQueue: vi.fn(),
  pauseQueue: vi.fn(),
  runQueueItem: mocks.runQueueItem,
  sendScenarioStatus: vi.fn(),
  startQueueConversation: mocks.startQueueConversation,
  waitForProviderReady: mocks.waitForProviderReady
}));
vi.mock('../src/background/messages', () => ({}));
vi.mock('../src/mcplab/api-client', () => ({ McplabClient: class {} }));

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number; reason: string; wasClean: boolean }) => void;
  constructor() {
    FakeWebSocket.instances.push(this);
  }
  send(value: string): void {
    this.sent.push(value);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

import {
  connectToMcplab,
  disableRoverConnection,
  enableRoverConnection,
  loadedProvider,
  startLeaseRenewal,
  updateRoverRegistration
} from '../src/background/socket';
import { createQueue } from '../src/queue/state';
import { serializeQueueOperation } from '../src/queue/operations';

const assignment = {
  type: 'assignment',
  jobId: 'job-1',
  leaseId: 'lease-1',
  leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
  agent: { provider: 'claude' },
  scenarios: [{ id: 'scenario-1', name: 'Scenario', prompt: 'Hello' }],
  newConversationBeforeStart: true
};

describe('socket assignment lifecycle', () => {
  beforeEach(async () => {
    mocks.getQueue.mockResolvedValue(null);
    await disableRoverConnection();
    FakeWebSocket.instances = [];
    vi.resetAllMocks();
    (globalThis as typeof globalThis & { WebSocket: unknown }).WebSocket =
      FakeWebSocket as unknown as typeof WebSocket;
    (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
      runtime: { getManifest: () => ({ version: '1.0.0' }) },
      tabs: {
        get: vi.fn(async () => ({ id: 7, url: 'https://claude.ai/chat/1' })),
        sendMessage: vi.fn(async () => undefined)
      },
      storage: { session: { remove: vi.fn() } }
    } as unknown as typeof chrome;
    mocks.resolveOrigin.mockResolvedValue('http://127.0.0.1:8787');
    mocks.activeTab.mockResolvedValue({ id: 7, url: 'https://claude.ai/chat/1' });
    mocks.detectProvider.mockResolvedValue('claude');
    mocks.waitForProviderReady.mockResolvedValue(undefined);
    mocks.startQueueConversation.mockResolvedValue(undefined);
    mocks.cancelActiveQueueItem.mockResolvedValue(undefined);
    mocks.saveQueue.mockResolvedValue(undefined);
  });

  it('does not create a socket after the toolbar disables a pending connection', async () => {
    let releaseTab!: (tab: { id: number; url: string }) => void;
    mocks.activeTab.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseTab = resolve;
        })
    );
    enableRoverConnection();
    await vi.waitFor(() => expect(mocks.activeTab).toHaveBeenCalled());
    await disableRoverConnection();
    releaseTab({ id: 7, url: 'https://claude.ai/chat/1' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('does not continue tab registration after the toolbar disables Rover', async () => {
    let releaseOrigin!: (origin: string) => void;
    mocks.resolveOrigin.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseOrigin = resolve;
        })
    );
    enableRoverConnection();
    const pending = updateRoverRegistration(7);
    await vi.waitFor(() => expect(mocks.resolveOrigin).toHaveBeenCalled());
    await disableRoverConnection();
    releaseOrigin('http://127.0.0.1:8787');
    await pending;
    expect(mocks.detectProvider).not.toHaveBeenCalled();
  });

  it('ignores built-in provider updates in background state', async () => {
    const socket = await connectedSocket();
    const workspaceProfile = {
      id: 'claude',
      schemaVersion: 1,
      name: 'Workspace Claude',
      source: 'workspace',
      match: { origins: ['https://claude.ai'] },
      composer: { locator: { segments: ['textarea'] }, inputMode: 'textarea' },
      submit: { action: 'enter' },
      assistantMessages: { locator: { segments: ['.assistant'] } },
      completion: { stabilityMs: 2500 },
      learned: {
        sourceOrigin: 'https://claude.ai',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        confidence: {}
      }
    };
    socket.message({ type: 'provider_updated', provider: workspaceProfile });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadedProvider('claude')?.name).toBe('Workspace Claude');

    socket.message({
      type: 'provider_updated',
      provider: {
        id: 'claude',
        schemaVersion: 1,
        name: 'MCP Lab Claude',
        source: 'builtin',
        match: { origins: ['https://claude.ai'] },
        composer: { locator: { segments: ['textarea'] }, inputMode: 'textarea' },
        submit: { action: 'enter' },
        assistantMessages: { locator: { segments: ['.assistant'] } },
        completion: { stabilityMs: 2500 },
        learned: {
          sourceOrigin: 'https://claude.ai',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
          confidence: {}
        }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadedProvider('claude')?.name).toBe('Workspace Claude');
  });

  it('stops and releases an active leased queue when Rover is disabled', async () => {
    const socket = await connectedSocket();
    mocks.getQueue.mockResolvedValue({
      ...createQueue('http://127.0.0.1:8787', 'claude', true, new Date().toISOString()),
      queueId: 'job-1',
      status: 'running',
      leaseId: 'lease-1',
      activeItemId: 'item-1'
    });
    await disableRoverConnection();
    expect(mocks.cancelActiveQueueItem).toHaveBeenCalledOnce();
    expect(mocks.saveQueue).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: 'job-1', status: 'stopped' })
    );
    expect(mocks.saveQueue.mock.calls.at(-1)?.[0]).not.toHaveProperty('leaseId');
    expect(socket.sent.map((value) => JSON.parse(value).type)).toContain('lease_release');
    expect(socket.readyState).toBe(3);
  });

  it('waits for active browser cancellation before releasing its lease', async () => {
    const socket = await connectedSocket();
    mocks.getQueue.mockResolvedValue({
      ...createQueue('http://127.0.0.1:8787', 'claude', true, new Date().toISOString()),
      queueId: 'job-1',
      status: 'running',
      leaseId: 'lease-1',
      activeItemId: 'item-1'
    });
    let finishCancellation!: () => void;
    mocks.cancelActiveQueueItem.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCancellation = resolve;
        })
    );
    const closing = disableRoverConnection();
    await vi.waitFor(() => expect(mocks.cancelActiveQueueItem).toHaveBeenCalledOnce());
    expect(mocks.saveQueue).not.toHaveBeenCalled();
    expect(socket.sent.map((value) => JSON.parse(value).type)).not.toContain('lease_release');
    finishCancellation();
    await closing;
    expect(mocks.saveQueue).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: 'job-1', status: 'stopped' })
    );
    expect(socket.sent.map((value) => JSON.parse(value).type)).toContain('lease_release');
  });

  it('renews a lease while a serialized evaluation operation is blocked', async () => {
    const socket = await connectedSocket();
    const queue = {
      ...createQueue('http://127.0.0.1:8787', 'claude', true, new Date().toISOString()),
      queueId: 'job-1',
      status: 'running' as const,
      leaseId: 'lease-1',
      leaseState: 'running' as const
    };
    mocks.getQueue.mockResolvedValue(queue);
    let release!: () => void;
    const blocked = serializeQueueOperation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    vi.useFakeTimers();
    try {
      await startLeaseRenewal(queue);
      await vi.advanceTimersByTimeAsync(31_000);
      expect(socket.sent.filter((value) => JSON.parse(value).type === 'lease_renew')).toHaveLength(
        2
      );
    } finally {
      release();
      await blocked;
      vi.useRealTimers();
      await disableRoverConnection();
    }
  });

  it('still stops and releases the queue if cancellation fails', async () => {
    const socket = await connectedSocket();
    mocks.getQueue.mockResolvedValue({
      ...createQueue('http://127.0.0.1:8787', 'claude', true, new Date().toISOString()),
      queueId: 'job-1',
      status: 'running',
      leaseId: 'lease-1',
      activeItemId: 'item-1'
    });
    mocks.cancelActiveQueueItem.mockRejectedValue(new Error('Tab disappeared'));
    await disableRoverConnection();
    expect(mocks.saveQueue).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: 'job-1', status: 'stopped' })
    );
    expect(socket.sent.map((value) => JSON.parse(value).type)).toContain('lease_release');
  });

  async function connectedSocket(): Promise<FakeWebSocket> {
    const existing = FakeWebSocket.instances.at(-1);
    if (existing?.readyState === FakeWebSocket.OPEN) return existing;
    enableRoverConnection();
    await connectToMcplab();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await vi.waitFor(() =>
      expect(socket.sent.some((value) => JSON.parse(value).type === 'register')).toBe(true)
    );
    socket.message({ type: 'registered', protocolVersion: 2, capabilities: ['assignment_lease'] });
    return socket;
  }

  it('rejects an assignment while an existing queue is busy', async () => {
    mocks.getQueue.mockResolvedValue({
      ...createQueue('http://127.0.0.1:8787', 'claude', true, new Date().toISOString()),
      status: 'running'
    });
    const socket = await connectedSocket();
    socket.message(assignment);
    await vi.waitFor(() =>
      expect(socket.sent.map((value) => JSON.parse(value).type)).toContain('assignment_reject')
    );
    expect(
      JSON.parse(socket.sent.find((value) => JSON.parse(value).type === 'assignment_reject')!)
        .reason
    ).toBe('busy');
  });

  it('accepts a compatible assignment and starts its queue', async () => {
    mocks.getQueue.mockResolvedValue(null);
    const socket = await connectedSocket();
    const sentBefore = socket.sent.length;
    socket.message(assignment);
    await vi.waitFor(() => expect(mocks.runQueueItem).toHaveBeenCalled());
    expect(mocks.startQueueConversation).toHaveBeenCalled();
    const assignmentMessages = socket.sent.slice(sentBefore).map((value) => JSON.parse(value).type);
    expect(assignmentMessages).toContain('assignment_accept');
    expect(assignmentMessages).not.toContain('assignment_reject');
  });

  it('rejects before acceptance when the new conversation cannot become ready', async () => {
    mocks.getQueue.mockResolvedValue(null);
    mocks.startQueueConversation.mockRejectedValue(
      new Error('tm-pipeline new conversation did not become ready')
    );
    const socket = await connectedSocket();
    const sentBefore = socket.sent.length;
    socket.message(assignment);

    await vi.waitFor(() =>
      expect(socket.sent.slice(sentBefore).map((value) => JSON.parse(value).type)).toContain(
        'assignment_reject'
      )
    );
    const messages = socket.sent.slice(sentBefore).map((value) => JSON.parse(value));
    expect(messages.some((message) => message.type === 'assignment_accept')).toBe(false);
    expect(messages.find((message) => message.type === 'assignment_reject')).toMatchObject({
      reason: 'provider_unavailable',
      retryable: true
    });
  });

  it('ignores a duplicate delivery of the same leased assignment', async () => {
    let storedQueue: any = null;
    mocks.getQueue.mockImplementation(async () => storedQueue);
    mocks.saveQueue.mockImplementation(async (queue) => {
      storedQueue = queue;
    });
    const socket = await connectedSocket();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const sentBefore = socket.sent.length;
    socket.message(assignment);
    await vi.waitFor(() => expect(mocks.runQueueItem).toHaveBeenCalledTimes(1));
    socket.message(assignment);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const assignmentAccepts = socket.sent
      .slice(sentBefore)
      .filter((value) => JSON.parse(value).type === 'assignment_accept');
    const assignmentRejects = socket.sent
      .slice(sentBefore)
      .filter((value) => JSON.parse(value).type === 'assignment_reject');
    expect(assignmentAccepts).toHaveLength(1);
    expect(assignmentRejects).toHaveLength(0);
    expect(mocks.runQueueItem).toHaveBeenCalledTimes(1);
  });
});
