// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createQueue, addQueueItem, startQueue, recordQueueItemOutcome } from '../src/queue/state';
import { clearLeaseState } from '../src/queue/lease-outbox';

let sendMessage: ReturnType<typeof vi.fn>;
let storageChanged: (changes: Record<string, { newValue: unknown }>, area: string) => void;

beforeEach(async () => {
  vi.resetModules();
  document.documentElement.innerHTML = readFileSync('rover.html', 'utf8');
  let queue = startQueue(
    addQueueItem(createQueue('http://localhost:8787', 'claude', false, 'now'), {
      id: 'case',
      name: 'Search assets',
      prompt: '',
      assertionCount: 1
    }),
    'now'
  );
  queue = recordQueueItemOutcome(
    queue,
    queue.activeItemId!,
    'passed',
    { resultUrl: '/results/saved' },
    'now'
  );
  sendMessage = vi.fn(async (message) => {
    if (message.type === 'ROVER_QUEUE_GET') return queue;
    if (message.type === 'ROVER_GET_ACTIVE_PROVIDER') return { provider: 'claude' };
    if (message.type === 'ROVER_QUEUE_DISMISS_HISTORY')
      return { ok: true, queue: { ...queue, recentHistory: { claude: [] } } };
    return null;
  });
  vi.stubGlobal('chrome', {
    runtime: { sendMessage, onMessage: { addListener: vi.fn() } },
    storage: {
      local: { get: vi.fn(async () => ({})) },
      onChanged: {
        addListener: vi.fn((listener) => {
          storageChanged = listener;
        })
      }
    }
  });
  await import('../src/popup/main');
  await vi.waitFor(() =>
    expect(document.querySelector('.queue-group-title')?.textContent).toContain(
      'Recent claude evaluations (1)'
    )
  );
});

afterEach(() => vi.unstubAllGlobals());

it('shows passed evaluations as an accessible green check', () => {
  const status = document.querySelector<HTMLElement>('.queue-item-status')!;
  expect(status.textContent).toBe('✓');
  expect(status.getAttribute('aria-label')).toBe('Passed');
  expect(status.dataset.status).toBe('passed');
  expect(status.nextElementSibling?.className).toBe('queue-item-name');
  expect(status.nextElementSibling?.textContent).toBe('1. Search assets');
});

it('shows a failed cross before the number and name', async () => {
  let queue = startQueue(
    addQueueItem(createQueue('http://localhost:8787', 'claude', false, 'now'), {
      id: 'failed-case',
      name: 'Hi There',
      prompt: '',
      assertionCount: 1
    }),
    'now'
  );
  queue = recordQueueItemOutcome(queue, queue.activeItemId!, 'failed', {}, 'now');
  storageChanged({ 'rover.queue': { newValue: queue } }, 'session');
  const status = document.querySelector<HTMLElement>('.queue-item-status')!;
  expect(status.textContent).toBe('✕');
  expect(status.getAttribute('aria-label')).toBe('Failed');
  expect(status.dataset.status).toBe('failed');
  expect(status.nextElementSibling?.textContent).toBe('1. Hi There');
});

it('removes a recent entry through the history action and updates the list', async () => {
  const remove = document.querySelector<HTMLButtonElement>(
    '[aria-label="Remove Search assets from Rover history"]'
  );
  expect(remove).not.toBeNull();
  expect(remove!.textContent).not.toContain('Remove');
  expect(remove!.querySelector('svg')).not.toBeNull();
  remove!.click();
  await vi.waitFor(() => expect(document.querySelector('.queue-item')).toBeNull());
  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'ROVER_QUEUE_DISMISS_HISTORY', provider: 'claude' })
  );
});

it('shows a removal failure and allows retry', async () => {
  const remove = document.querySelector<HTMLButtonElement>(
    '[aria-label="Remove Search assets from Rover history"]'
  );
  expect(remove).not.toBeNull();
  sendMessage.mockResolvedValueOnce({ ok: false, error: 'Storage unavailable' });
  remove!.click();
  await vi.waitFor(() =>
    expect(document.querySelector('#queue-status')?.textContent).toContain('Storage unavailable')
  );
  expect(remove!.disabled).toBe(false);
  expect(document.querySelector('.queue-item')).not.toBeNull();
});

it.each(['completed', 'stopped'] as const)(
  'shows readiness after a %s assignment is settled',
  (status) => {
    const queue = clearLeaseState({
      ...createQueue('http://localhost:8787', 'claude', false, 'now'),
      status,
      evaluationRunId: 'run',
      managedPhase: 'running',
      leaseId: 'lease'
    });
    storageChanged({ 'rover.queue': { newValue: queue } }, 'session');
    expect(document.querySelector('#queue-status')?.textContent).toBe('Ready for next evaluation.');
  }
);

it('shows readiness after a completed assignment on a different provider page', () => {
  const queue = clearLeaseState({
    ...createQueue('http://localhost:8787', 'chatgpt-com', false, 'now'),
    status: 'completed',
    evaluationRunId: 'run',
    managedPhase: 'running',
    leaseId: 'lease'
  });
  storageChanged({ 'rover.queue': { newValue: queue } }, 'session');
  expect(document.querySelector('#queue-status')?.textContent).toBe('Ready for next evaluation.');
});

it('keeps acknowledgement progress visible until MCPLab settles the assignment', () => {
  const queue = {
    ...createQueue('http://localhost:8787', 'claude', false, 'now'),
    status: 'completed',
    evaluationRunId: 'run',
    managedPhase: 'waiting_ack',
    pendingLeaseActions: [{ type: 'complete', leaseId: 'lease' }]
  };
  storageChanged({ 'rover.queue': { newValue: queue } }, 'session');
  expect(document.querySelector('#queue-status')?.textContent).toBe(
    'Waiting for MCPLab acknowledgement.'
  );
});
