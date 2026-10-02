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
    if (message.type === 'ROVER_GET_CATALOG')
      return {
        ok: true,
        origin: 'http://localhost:8787',
        testCases: [
          { id: 'case', name: 'Search assets', assertionCount: 1, eligible: true },
          { id: 'unsupported', name: 'Unsupported case', assertionCount: 0, eligible: false }
        ]
      };
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

it('places connection controls beside the title with working settings and connection status', async () => {
  const titleRow = document.querySelector('h1')!.parentElement;
  const connection = document.querySelector<HTMLElement>('#connection-status')!;
  const settings = document.querySelector<HTMLButtonElement>('#connection-settings')!;
  expect(connection.parentElement).toBe(titleRow);
  expect(settings.parentElement).toBe(titleRow);
  expect(document.querySelector('.connection-label')).toBeNull();
  const controls = document.querySelector<HTMLElement>('#connection-controls')!;
  const preferences = document.querySelector<HTMLElement>('#connection-preferences')!;
  settings.click();
  expect(controls.hidden).toBe(false);
  expect(preferences.hidden).toBe(false);
  expect(settings.getAttribute('aria-expanded')).toBe('true');
  sendMessage.mockResolvedValueOnce({ ok: true, origin: 'http://localhost:8787', testCases: [] });
  document.querySelector<HTMLButtonElement>('#connect')!.click();
  await vi.waitFor(() => expect(connection.dataset.state).toBe('connected'));
  expect(connection.textContent).toBe('Connected');
  expect(document.querySelector<HTMLElement>('#connection-dot')!.title).toBe('Connected');
  settings.click();
  expect(controls.hidden).toBe(true);
  expect(preferences.hidden).toBe(true);
  expect(settings.getAttribute('aria-expanded')).toBe('false');
});

it('populates the queue dropdown when startup switches to Queue before catalog loading finishes', async () => {
  const dropdown = document.querySelector<HTMLSelectElement>('#queue-evaluation')!;
  await vi.waitFor(() => expect(dropdown.options.length).toBe(2));
  expect(document.querySelector<HTMLElement>('#queue-panel')!.hidden).toBe(false);
  expect(dropdown.value).toBe('case');
  expect(dropdown.disabled).toBe(false);
  const add = document.querySelector<HTMLButtonElement>('#queue-add')!;
  expect(add.disabled).toBe(false);
  sendMessage.mockClear();
  add.click();
  await vi.waitFor(() =>
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'ROVER_QUEUE_ADD',
      item: { id: 'case', name: 'Search assets', prompt: '', assertionCount: 1 }
    })
  );
});

it('disables Add when the selected evaluation is unsupported', async () => {
  const dropdown = document.querySelector<HTMLSelectElement>('#queue-evaluation')!;
  await vi.waitFor(() => expect(dropdown.options.length).toBe(2));
  dropdown.value = 'unsupported';
  dropdown.dispatchEvent(new Event('change'));
  expect(document.querySelector<HTMLButtonElement>('#queue-add')!.disabled).toBe(true);
  dropdown.value = 'case';
  dropdown.dispatchEvent(new Event('change'));
  expect(document.querySelector<HTMLButtonElement>('#queue-add')!.disabled).toBe(false);
});

it('shows loading and an empty catalog in Queue with Add disabled', async () => {
  let finish!: (value: unknown) => void;
  sendMessage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  document.querySelector<HTMLButtonElement>('#connect')!.click();
  const dropdown = document.querySelector<HTMLSelectElement>('#queue-evaluation')!;
  expect(dropdown.textContent).toBe('Loading evaluations…');
  expect(dropdown.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('#queue-add')!.disabled).toBe(true);
  finish({ ok: true, origin: 'http://localhost:8787', testCases: [] });
  await vi.waitFor(() => expect(dropdown.textContent).toBe('No evaluations found'));
  expect(dropdown.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('#queue-add')!.disabled).toBe(true);
});

it.each(['response', 'exception'])(
  'shows a catalog error in Queue after a failed %s and recovers on reconnect',
  async (failure) => {
    if (failure === 'response') sendMessage.mockResolvedValueOnce({ ok: false, error: 'Offline' });
    else sendMessage.mockRejectedValueOnce(new Error('Offline'));
    document.querySelector<HTMLButtonElement>('#connect')!.click();
    const dropdown = document.querySelector<HTMLSelectElement>('#queue-evaluation')!;
    await vi.waitFor(() => expect(dropdown.textContent).toBe('Could not load evaluations'));
    expect(dropdown.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#queue-add')!.disabled).toBe(true);
    document.querySelector<HTMLButtonElement>('#connect')!.click();
    await vi.waitFor(() => expect(dropdown.options.length).toBe(2));
    expect(dropdown.value).toBe('case');
    expect(document.querySelector<HTMLButtonElement>('#queue-add')!.disabled).toBe(false);
  }
);


it('only shows Run queue while there are unfinished local evaluations', () => {
  const run = document.querySelector<HTMLButtonElement>('#queue-start')!;
  expect(run.hidden).toBe(true);
  const empty = createQueue('http://localhost:8787', 'claude', false, 'now');
  storageChanged({ 'rover.queue': { newValue: empty } }, 'session');
  expect(run.hidden).toBe(true);
  const queued = addQueueItem(empty, {
    id: 'case', name: 'Search assets', prompt: '', assertionCount: 1
  });
  storageChanged({ 'rover.queue': { newValue: queued } }, 'session');
  expect(run.hidden).toBe(false);
  expect(run.disabled).toBe(false);
  const running = startQueue(queued, 'now');
  storageChanged({ 'rover.queue': { newValue: running } }, 'session');
  expect(run.disabled).toBe(true);
  const completed = recordQueueItemOutcome(running, running.activeItemId!, 'passed', {}, 'now');
  storageChanged({ 'rover.queue': { newValue: completed } }, 'session');
  expect(run.hidden).toBe(true);
  storageChanged({ 'rover.queue': { newValue: null } }, 'session');
  expect(run.hidden).toBe(true);
});


it('hides the empty queue status but shows errors and progress', async () => {
  const style = document.createElement('style');
  style.textContent = readFileSync('src/popup/style.css', 'utf8');
  document.head.append(style);
  const empty = createQueue('http://localhost:8787', 'claude', false, 'now');
  storageChanged({ 'rover.queue': { newValue: empty } }, 'session');
  const status = document.querySelector<HTMLElement>('#queue-status')!;
  expect(status.textContent).toBe('');
  expect(getComputedStyle(status).display).toBe('none');
  sendMessage.mockResolvedValueOnce({ ok: false, error: 'Could not add evaluation' });
  document.querySelector<HTMLButtonElement>('#queue-add')!.click();
  await vi.waitFor(() => expect(status.textContent).toBe('Could not add evaluation'));
  expect(getComputedStyle(status).display).not.toBe('none');
  const queued = addQueueItem(empty, {
    id: 'case',
    name: 'Search assets',
    prompt: '',
    assertionCount: 1
  });
  storageChanged({ 'rover.queue': { newValue: queued } }, 'session');
  expect(status.textContent).toBe('0/1 evaluations processed.');
  expect(getComputedStyle(status).display).not.toBe('none');
  storageChanged({ 'rover.queue': { newValue: null } }, 'session');
  expect(getComputedStyle(status).display).not.toBe('none');
  expect(status.textContent).toContain('requires a supported or learned browser provider');
});


it('orders the evaluation dropdown alphabetically by name', async () => {
  sendMessage.mockResolvedValueOnce({
    ok: true,
    origin: 'http://localhost:8787',
    testCases: [
      { id: 'z', name: 'Zulu', assertionCount: 1, eligible: true },
      { id: 'b', name: 'beta', assertionCount: 1, eligible: true },
      { id: 'a', name: 'Alpha', assertionCount: 1, eligible: true }
    ]
  });
  document.querySelector<HTMLButtonElement>('#connect')!.click();
  const dropdown = document.querySelector<HTMLSelectElement>('#queue-evaluation')!;
  await vi.waitFor(() => expect(dropdown.options.length).toBe(3));
  expect(Array.from(dropdown.options, (option) => option.textContent)).toEqual([
    'Alpha', 'beta', 'Zulu'
  ]);
});
