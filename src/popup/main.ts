import type { RoverState } from '../contracts';
import type { LiveTestCatalogItem } from '../mcplab/types';
import type { RoverQueueState } from '../queue/state';
import { filterTestCases, formatCheckCounts, modeVisibility } from './view-model';
import './style.css';

const shell = document.querySelector<HTMLElement>('.shell')!;
const provider = document.querySelector<HTMLParagraphElement>('#provider')!;
const origin = document.querySelector<HTMLInputElement>('#origin')!;
const connect = document.querySelector<HTMLButtonElement>('#connect')!;
const connectionSettings = document.querySelector<HTMLButtonElement>('#connection-settings')!;
const connectionControls = document.querySelector<HTMLDivElement>('#connection-controls')!;
const catalog = document.querySelector<HTMLElement>('#catalog')!;
const search = document.querySelector<HTMLInputElement>('#search')!;
const testCase = document.querySelector<HTMLSelectElement>('#test-case')!;
const selectionNote = document.querySelector<HTMLParagraphElement>('#selection-note')!;
const prepare = document.querySelector<HTMLButtonElement>('#prepare')!;
const session = document.querySelector<HTMLElement>('#session')!;
const testName = document.querySelector<HTMLElement>('#test-name')!;
const prompt = document.querySelector<HTMLPreElement>('#prompt')!;
const run = document.querySelector<HTMLButtonElement>('#run')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const copyPrompt = document.querySelector<HTMLButtonElement>('#copy-prompt')!;
const manualAnswer = document.querySelector<HTMLTextAreaElement>('#manual-answer')!;
const evaluate = document.querySelector<HTMLButtonElement>('#evaluate')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const outcome = document.querySelector<HTMLParagraphElement>('#outcome')!;
const checks = document.querySelector<HTMLParagraphElement>('#checks')!;
const result = document.querySelector<HTMLPreElement>('#result')!;
const openResult = document.querySelector<HTMLButtonElement>('#open-result')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const connectionStatus = document.querySelector<HTMLSpanElement>('#connection-status')!;
const connectionDot = document.querySelector<HTMLSpanElement>('#connection-dot')!;
const manualMode = document.querySelector<HTMLButtonElement>('#manual-mode')!;
const queueMode = document.querySelector<HTMLButtonElement>('#queue-mode')!;
const queuePanel = document.querySelector<HTMLElement>('#queue-panel')!;
const queueEvaluation = document.querySelector<HTMLSelectElement>('#queue-evaluation')!;
const queueAdd = document.querySelector<HTMLButtonElement>('#queue-add')!;
const queueNewChat = document.querySelector<HTMLInputElement>('#queue-new-chat')!;
const queueItems = document.querySelector<HTMLElement>('#queue-items')!;
const queueStatus = document.querySelector<HTMLParagraphElement>('#queue-status')!;
const queueStart = document.querySelector<HTMLButtonElement>('#queue-start')!;
const queueRetry = document.querySelector<HTMLButtonElement>('#queue-retry')!;
const queueSkip = document.querySelector<HTMLButtonElement>('#queue-skip')!;
const queueStop = document.querySelector<HTMLButtonElement>('#queue-stop')!;

let items: LiveTestCatalogItem[] = [];
let current: RoverState | null = null;
let currentQueue: RoverQueueState | null = null;
let mode: 'manual' | 'queue' = 'manual';

function setConnectionState(state: 'connecting' | 'connected' | 'disconnected', message: string): void {
  connectionStatus.dataset.state = state;
  connectionDot.title = message;
  connectionStatus.lastElementChild!.textContent = message;
  window.parent.postMessage({ type: 'ROVER_CONNECTION_STATE', connected: state === 'connected' }, '*');
}

function reportPanelSize(): void {
  window.parent.postMessage({
    type: 'ROVER_PANEL_SIZE',
    height: Math.ceil(Math.max(shell.scrollHeight, shell.getBoundingClientRect().height))
  }, '*');
}

if (window.parent !== window && 'ResizeObserver' in window) {
  new ResizeObserver(reportPanelSize).observe(shell);
}

connectionSettings.addEventListener('click', () => {
  const expanded = !connectionControls.hidden;
  connectionControls.hidden = expanded;
  connectionSettings.setAttribute('aria-expanded', String(!expanded));
});
manualMode.addEventListener('click', () => setMode('manual'));
queueMode.addEventListener('click', async () => {
  setMode('queue');
  if (!currentQueue) {
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_QUEUE_CREATE',
      origin: origin.value,
      newConversationBetweenItems: queueNewChat.checked
    });
    if (response?.ok) renderQueue(response.queue);
    else queueStatus.textContent = response?.error ?? 'Could not create queue.';
  }
});
queueAdd.addEventListener('click', async () => {
  const item = items.find((candidate) => candidate.id === queueEvaluation.value);
  if (!item?.eligible) return;
  const response = await chrome.runtime.sendMessage({
    type: 'ROVER_QUEUE_ADD',
    item: { id: item.id, name: item.name, prompt: '', assertionCount: item.assertionCount }
  });
  if (response?.ok) renderQueue(response.queue);
  else queueStatus.textContent = response?.error ?? 'Could not add evaluation.';
});
queueNewChat.addEventListener('change', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_SET_NEW_CHAT', enabled: queueNewChat.checked });
  if (response?.ok) renderQueue(response.queue);
  else queueStatus.textContent = response?.error ?? 'Could not update conversation setting.';
});
queueStart.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_START' });
  if (response?.ok) renderQueue(response.queue);
  else queueStatus.textContent = response?.error ?? 'Could not start queue.';
});
queueRetry.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_RETRY' });
  if (response?.ok) renderQueue(response.queue);
});
queueSkip.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_SKIP' });
  if (response?.ok) renderQueue(response.queue);
});
queueStop.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_STOP' });
  if (response?.ok) renderQueue(response.queue);
});

function selectedItem(): LiveTestCatalogItem | undefined {
  return items.find((item) => item.id === testCase.value);
}

function setMode(next: 'manual' | 'queue'): void {
  mode = next;
  manualMode.classList.toggle('active', mode === 'manual');
  queueMode.classList.toggle('active', mode === 'queue');
  manualMode.setAttribute('aria-selected', String(mode === 'manual'));
  queueMode.setAttribute('aria-selected', String(mode === 'queue'));
  const visibility = modeVisibility(mode, Boolean(current));
  catalog.hidden = !visibility.catalog;
  session.hidden = !visibility.session;
  queuePanel.hidden = !visibility.queue;
  if (mode === 'queue') renderQueue(currentQueue);
}

function renderQueue(queue: RoverQueueState | null): void {
  currentQueue = queue;
  if (!queue) {
    queueItems.replaceChildren();
    queueStatus.textContent = 'Queue mode requires a supported Claude or TrendMiner page.';
    queueStart.disabled = true;
    queueRetry.hidden = true;
    queueSkip.hidden = true;
    queueStop.hidden = true;
    return;
  }
  queueNewChat.checked = queue.newConversationBetweenItems;
  queueItems.replaceChildren(...queue.items.map((item, index) => {
    const row = document.createElement('div');
    row.className = 'queue-item';
    const name = document.createElement('span');
    name.className = 'queue-item-name';
    name.textContent = `${index + 1}. ${item.name}`;
    const itemStatus = document.createElement('span');
    itemStatus.className = 'queue-item-status';
    itemStatus.textContent = item.status;
    row.append(name, itemStatus);
    for (const [action, label] of [['up', '↑'], ['down', '↓'], ['remove', '×']] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = action;
      button.disabled = item.status !== 'queued' || (action === 'up' && index === 0) || (action === 'down' && index === queue.items.length - 1);
      button.addEventListener('click', () => void chrome.runtime.sendMessage({ type: action === 'remove' ? 'ROVER_QUEUE_REMOVE' : 'ROVER_QUEUE_MOVE', queueItemId: item.queueItemId, ...(action === 'remove' ? {} : { direction: action }) }));
      row.append(button);
    }
    return row;
  }));
  queueStatus.textContent = queue.status === 'paused'
    ? `Paused: ${queue.error?.message ?? 'Queue needs attention.'}`
    : queue.status === 'completed' ? 'Queue completed.' : `${queue.items.filter((item) => item.status !== 'queued').length}/${queue.items.length} evaluations processed.`;
  queueStart.disabled = queue.items.length === 0 || queue.status === 'running' || queue.status === 'paused';
  queueRetry.hidden = queue.status !== 'paused';
  queueSkip.hidden = queue.status !== 'paused';
  queueStop.hidden = !['running', 'paused'].includes(queue.status);
}

function renderCatalog(): void {
  const visible = filterTestCases(items, search.value);
  testCase.replaceChildren(...visible.map((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.name}${item.eligible ? '' : ' (unsupported)'}`;
    return option;
  }));
  queueEvaluation.replaceChildren(...visible.map((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.name}${item.eligible ? '' : ' (unsupported)'}`;
    option.disabled = !item.eligible;
    return option;
  }));
  updateSelection();
}

function updateSelection(): void {
  const item = selectedItem();
  prepare.disabled = !item?.eligible;
  selectionNote.textContent = item?.ineligibleReason ?? (item ? `${item.assertionCount} checks` : 'Select a test case.');
}

function render(state: RoverState | null): void {
  current = state;
  shell.dataset.state = state?.status ?? 'ready';
  shell.dataset.outcome = state?.outcome ?? '';
  const active = Boolean(state);
  if (mode === 'manual') {
    catalog.hidden = active;
    session.hidden = !active;
  }
  queuePanel.hidden = mode !== 'queue';
  outcome.hidden = state?.status !== 'completed';
  checks.hidden = state?.status !== 'completed';
  result.hidden = !state?.text;
  openResult.hidden = state?.status !== 'completed';
  reset.hidden = !state || !['completed', 'error'].includes(state.status);
  stop.hidden = !state || ['completed', 'error'].includes(state.status);
  run.hidden = state?.status !== 'ready';
  copyPrompt.hidden = state?.status !== 'manual';
  manualAnswer.hidden = state?.status !== 'manual';
  evaluate.hidden = state?.status !== 'manual';

  if (!state) {
    provider.textContent = 'Connect to choose a Live Test';
    status.textContent = items.length ? 'Choose a test case' : 'Ready';
    return;
  }
  testName.textContent = state.testCaseName;
  prompt.textContent = state.prompt;
  provider.textContent = state.provider ? `Active chat: ${state.provider}` : 'Manual browser handoff';
  result.textContent = state.text ?? '';
  status.textContent = {
    ready: 'Review the prompt, then run it in the active chat.',
    manual: 'Unsupported page. Copy the prompt, then paste the final answer.',
    running: 'Waiting for the agent response…',
    evaluating: 'Evaluating in MCPLab…',
    completed: 'Live Test saved.',
    error: `Error: ${state.error ?? 'Live Test failed.'}`
  }[state.status];
  if (state.status === 'completed') {
    outcome.textContent = state.outcome?.toUpperCase() ?? 'COMPLETED';
    const count = state.checkCounts;
    checks.textContent = count ? formatCheckCounts(count) : '';
  }
}

async function loadCatalog(requestedOrigin?: string): Promise<void> {
  connect.disabled = true;
  setConnectionState('connecting', 'Connecting…');
  status.textContent = 'Connecting to MCPLab…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'ROVER_GET_CATALOG', origin: requestedOrigin });
    connect.disabled = false;
    if (!response?.ok) {
      setConnectionState('disconnected', 'Disconnected');
      status.textContent = `Connection error: ${response?.error ?? 'Could not connect.'}`;
      return;
    }
    setConnectionState('connected', 'Connected');
    origin.value = response.origin;
    items = response.testCases;
    if (!current && mode === 'manual') {
      catalog.hidden = false;
      renderCatalog();
      status.textContent = items.length ? 'Choose a test case' : 'No test cases found.';
    }
  } catch (error) {
    connect.disabled = false;
    setConnectionState('disconnected', 'Disconnected');
    status.textContent = `Connection error: ${error instanceof Error ? error.message : 'Could not connect.'}`;
  }
}

connect.addEventListener('click', () => void loadCatalog(origin.value));
search.addEventListener('input', renderCatalog);
testCase.addEventListener('change', updateSelection);

prepare.addEventListener('click', async () => {
  const item = selectedItem();
  if (!item?.eligible) return;
  prepare.disabled = true;
  status.textContent = 'Preparing Live Test…';
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_PREPARE', testCaseId: item.id, origin: origin.value });
  prepare.disabled = false;
  if (!response?.ok) status.textContent = `Error: ${response?.error ?? 'Could not prepare Live Test.'}`;
  else render(response.state);
});

run.addEventListener('click', async () => {
  run.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_EXECUTE' });
  run.disabled = false;
  if (!response?.ok) status.textContent = `Error: ${response?.error ?? 'Could not run Live Test.'}`;
  else render(response.state);
});

stop.addEventListener('click', async () => {
  stop.disabled = true;
  status.textContent = 'Stopping Live Test…';
  await chrome.runtime.sendMessage({ type: 'ROVER_CANCEL' });
  stop.disabled = false;
  manualAnswer.value = '';
  render(null);
  await loadCatalog(origin.value);
});

copyPrompt.addEventListener('click', async () => {
  await navigator.clipboard.writeText(current?.prompt ?? '');
  status.textContent = 'Prompt copied. Paste it into your agent.';
});

evaluate.addEventListener('click', async () => {
  if (!manualAnswer.value.trim()) {
    status.textContent = 'Paste the final answer first.';
    return;
  }
  evaluate.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_COMPLETE_MANUAL', text: manualAnswer.value });
  evaluate.disabled = false;
  if (!response?.ok) status.textContent = `Evaluation error: ${response?.error ?? 'Could not evaluate answer.'}`;
  else render(response.state);
});

openResult.addEventListener('click', async () => {
  if (current?.resultUrl) await chrome.tabs.create({ url: `${current.origin}${current.resultUrl}` });
});

reset.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'ROVER_CANCEL' });
  manualAnswer.value = '';
  render(null);
  await loadCatalog(origin.value);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes['rover.run']) render(changes['rover.run'].newValue as RoverState | null);
  if (area === 'session' && changes['rover.queue']) renderQueue(changes['rover.queue'].newValue as RoverQueueState | null);
});

void chrome.runtime.sendMessage({ type: 'ROVER_GET_STATE' }).then((state: RoverState | null) => {
  if (state) render(state);
  void loadCatalog(state?.origin);
  reportPanelSize();
});
void chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_GET' }).then((queue: RoverQueueState | null) => {
  renderQueue(queue);
  if (queue) setMode('queue');
});
