// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createQueue, addQueueItem, startQueue, recordQueueItemOutcome } from '../src/queue/state';
import { clearLeaseState } from '../src/queue/lease-outbox';

let sendMessage: ReturnType<typeof vi.fn>;
let runtimeMessage: (message: { type: string }) => void;
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
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener) => {
          runtimeMessage = listener;
        })
      }
    },
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shows passed evaluations as an accessible green check', () => {
  const status = document.querySelector<HTMLElement>('.queue-item-status')!;
  expect(status.textContent).toBe('✓');
  expect(status.getAttribute('aria-label')).toBe('Passed');
  expect(status.dataset.status).toBe('passed');
  expect(status.nextElementSibling?.className).toBe('queue-item-name');
  expect(status.nextElementSibling?.textContent).toBe('1. Search assets');
});

it('shows an accessible running spinner before the name and replaces it on completion', () => {
  const queue = startQueue(
    addQueueItem(createQueue('http://localhost:8787', 'claude', false, 'now'), {
      id: 'running-case',
      name: 'Working',
      prompt: '',
      assertionCount: 1
    }),
    'now'
  );
  sendMessage.mockClear();
  storageChanged({ 'rover.queue': { newValue: queue } }, 'session');
  const status = document.querySelector<HTMLElement>('.queue-item-status')!;
  expect(status.dataset.status).toBe('running');
  expect(status.textContent).toBe('');
  expect(status.getAttribute('aria-label')).toBe('Running');
  expect(status.getAttribute('role')).toBe('img');
  expect(status.nextElementSibling?.textContent).toBe('1. Working');
  const completed = recordQueueItemOutcome(queue, queue.activeItemId!, 'passed', {}, 'now');
  storageChanged({ 'rover.queue': { newValue: completed } }, 'session');
  expect(document.querySelector('.queue-item-status')?.textContent).toBe('✓');
  expect(document.querySelector('[data-status="running"]')).toBeNull();
  expect(sendMessage).not.toHaveBeenCalled();
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

it('updates the tab header in queue mode and preserves it when Live Test state changes', async () => {
  await vi.waitFor(() =>
    expect(document.querySelector('#provider')?.textContent).toBe('Active chat: Claude')
  );
  storageChanged(
    {
      'rover.run': {
        newValue: {
          status: 'ready',
          provider: 'chatgpt-com',
          testCaseName: 'Old session',
          prompt: ''
        }
      }
    },
    'session'
  );
  expect(document.querySelector('#provider')?.textContent).toBe('Active chat: Claude');
  storageChanged({ 'rover.run': { newValue: null } }, 'session');
  expect(document.querySelector('#provider')?.textContent).toBe('Active chat: Claude');
});

it.each([
  [{ provider: 'chatgpt-com' }, 'Active chat: ChatGPT'],
  [{ provider: 'local-chat', profile: { name: 'Local provider' } }, 'Active chat: Local provider'],
  [{}, 'No supported chat detected on this tab'],
  [{ error: 'Content script unavailable' }, 'Could not check this tab. Try reopening Rover.']
])('updates the header from the latest tab detection %j', async (response, label) => {
  sendMessage.mockResolvedValueOnce(response);
  runtimeMessage({ type: 'ROVER_ACTIVE_PROVIDER_CHANGED' });
  await vi.waitFor(() => expect(document.querySelector('#provider')?.textContent).toBe(label));
});

it('shows checking only while tab detection is pending', async () => {
  let resolveDetection!: (value: unknown) => void;
  sendMessage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveDetection = resolve;
      })
  );
  runtimeMessage({ type: 'ROVER_ACTIVE_PROVIDER_CHANGED' });
  expect(document.querySelector('#provider')?.textContent).toBe(
    'Checking this tab for a supported chat…'
  );
  resolveDetection({ provider: 'claude' });
  await vi.waitFor(() =>
    expect(document.querySelector('#provider')?.textContent).toBe('Active chat: Claude')
  );
});

it('ends the checking label when detection and its existing retry both fail', async () => {
  vi.useFakeTimers();
  sendMessage
    .mockRejectedValueOnce(new Error('Tab not available'))
    .mockRejectedValueOnce(new Error('Tab not available'));
  runtimeMessage({ type: 'ROVER_ACTIVE_PROVIDER_CHANGED' });
  await vi.advanceTimersByTimeAsync(500);
  expect(document.querySelector('#provider')?.textContent).toBe(
    'Could not check this tab. Try reopening Rover.'
  );
});
