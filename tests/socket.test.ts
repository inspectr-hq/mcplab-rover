import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeTab: vi.fn(),
  detectProvider: vi.fn(),
  getQueue: vi.fn(),
  saveQueue: vi.fn(),
  resolveOrigin: vi.fn(),
  waitForProviderReady: vi.fn(),
  runQueueItem: vi.fn(),
  startQueueConversation: vi.fn()
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
  cancelActiveQueueItem: vi.fn(),
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

import { connectToMcplab } from '../src/background/socket';
import { createQueue } from '../src/queue/state';

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
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { WebSocket: unknown }).WebSocket =
      FakeWebSocket as unknown as typeof WebSocket;
    (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
      runtime: { getManifest: () => ({ version: '1.0.0' }) },
      tabs: { get: vi.fn(async () => ({ id: 7, url: 'https://claude.ai/chat/1' })) },
      storage: { session: { remove: vi.fn() } }
    } as unknown as typeof chrome;
    mocks.resolveOrigin.mockResolvedValue('http://127.0.0.1:8787');
    mocks.activeTab.mockResolvedValue({ id: 7, url: 'https://claude.ai/chat/1' });
    mocks.detectProvider.mockResolvedValue('claude');
    mocks.waitForProviderReady.mockResolvedValue(undefined);
    mocks.saveQueue.mockResolvedValue(undefined);
  });

  async function connectedSocket(): Promise<FakeWebSocket> {
    const existing = FakeWebSocket.instances.at(-1);
    if (existing?.readyState === FakeWebSocket.OPEN) return existing;
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

    const assignmentAccepts = socket.sent.slice(sentBefore).filter(
      (value) => JSON.parse(value).type === 'assignment_accept'
    );
    const assignmentRejects = socket.sent.slice(sentBefore).filter(
      (value) => JSON.parse(value).type === 'assignment_reject'
    );
    expect(assignmentAccepts).toHaveLength(1);
    expect(assignmentRejects).toHaveLength(0);
    expect(mocks.runQueueItem).toHaveBeenCalledTimes(1);
  });
});
