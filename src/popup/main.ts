import type { BrowserProviderLearningDraft, DebugElementCheck, DebugSnapshot, RoverState } from '../contracts';
import type { LiveTestCatalogItem } from '../mcplab/types';
import type { RoverQueueState } from '../queue/state';
import { debugFingerprint, filterTestCases, formatCheckCounts, modeVisibility } from './view-model';
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
const statusRow = document.querySelector<HTMLDivElement>('.status-row')!;
const responseTray = document.querySelector<HTMLElement>('.response-tray')!;
const debugMode = document.querySelector<HTMLButtonElement>('#debug-mode')!;
const learnMode = document.querySelector<HTMLButtonElement>('#learn-mode')!;
const learnPanel = document.querySelector<HTMLElement>('#learn-panel')!;
const learnStatus = document.querySelector<HTMLParagraphElement>('#learn-status')!;
const learnCapabilities = document.querySelector<HTMLElement>('#learn-capabilities')!;
const learnName = document.querySelector<HTMLInputElement>('#learn-name')!;
const learnStart = document.querySelector<HTMLButtonElement>('#learn-start')!;
const learnSave = document.querySelector<HTMLButtonElement>('#learn-save')!;
const debugPanel = document.querySelector<HTMLElement>('#debug-panel')!;
const debugRefresh = document.querySelector<HTMLButtonElement>('#debug-refresh')!;
const debugUpdated = document.querySelector<HTMLParagraphElement>('#debug-updated')!;
const debugIndicators = document.querySelector<HTMLElement>('#debug-indicators')!;

let items: LiveTestCatalogItem[] = [];
let current: RoverState | null = null;
let currentQueue: RoverQueueState | null = null;
let mode: 'manual' | 'queue' | 'learn' | 'debug' = 'manual';
let learningDraft: BrowserProviderLearningDraft | null = null;
const LEARNING_DRAFT_KEY = 'rover.learning-draft';
let lastDebugFingerprint = '';
let debugRequestInFlight = false;
let lastDebugSnapshot: DebugSnapshot | null = null;

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
manualMode.addEventListener('click', () => void setMode('manual'));
queueMode.addEventListener('click', async () => {
  await setMode('queue');
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
debugMode.addEventListener('click', () => void setMode('debug'));
learnMode.addEventListener('click', () => void setMode('learn'));
learnStart.addEventListener('click', async () => {
  if (learnStart.textContent === 'Stop learning') {
    const response = await chrome.runtime.sendMessage({ type: 'ROVER_LEARN_STOP' });
    if (!response?.ok) {
      learnStatus.textContent = response?.error ?? 'Could not stop learning.';
      return;
    }
    learnStart.textContent = 'Start learning';
    learnStatus.textContent = 'Learning stopped. Start again when you are ready.';
    return;
  }
  learningDraft = null;
  learnCapabilities.replaceChildren();
  learnName.hidden = true;
  learnSave.hidden = true;
  learnStart.textContent = 'Stop learning';
  learnStatus.textContent = 'Learning is active. Send one message in the chat, then wait for the response.';
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_LEARN_START' });
  if (!response?.ok) {
    learnStatus.textContent = response?.error ?? 'Could not start learning.';
    learnStart.textContent = 'Start learning';
  }
});
learnSave.addEventListener('click', async () => {
  if (!learningDraft) return;
  const name = learnName.value.trim();
  if (!name) {
    learnStatus.textContent = 'Enter a provider name first.';
    return;
  }
  const profile = { ...learningDraft.profile, id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name };
  try {
    const agentId = `${profile.id}-browser`;
    const providerOrigin = profile.match.origins[0];
    if (!providerOrigin) throw new Error('The learned provider has no page origin.');
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_LEARN_SAVE',
      profile,
      agent: { id: agentId, name: `${name} browser`, url: providerOrigin },
      origin: origin.value
    });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not save provider.');
    learnStatus.textContent = `Saved ${name} to MCPLab.`;
    learnSave.hidden = true;
    learningDraft = null;
    await chrome.storage.local.remove(LEARNING_DRAFT_KEY);
  } catch (error) {
    learnStatus.textContent = error instanceof Error ? error.message : 'Could not save provider.';
  }
});
debugRefresh.addEventListener('click', () => void refreshDebug(true));
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

function showQueueError(response: { ok?: boolean; error?: string } | undefined, fallback: string): void {
  if (!response?.ok) queueStatus.textContent = response?.error ?? fallback;
}

queueRetry.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_RETRY' });
  if (response?.ok) renderQueue(response.queue);
  else showQueueError(response, 'Could not retry queue item.');
});
queueSkip.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_SKIP' });
  if (response?.ok) renderQueue(response.queue);
  else showQueueError(response, 'Could not skip queue item.');
});
queueStop.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_STOP' });
  if (response?.ok) renderQueue(response.queue);
  else showQueueError(response, 'Could not stop queue.');
});

function selectedItem(): LiveTestCatalogItem | undefined {
  return items.find((item) => item.id === testCase.value);
}

async function setMode(next: 'manual' | 'queue' | 'learn' | 'debug'): Promise<void> {
  if (next === mode) return;
  if (mode === 'learn' && next !== 'learn') {
    await chrome.runtime.sendMessage({ type: 'ROVER_LEARN_STOP' });
    learnStart.textContent = 'Start learning';
  }
  if (mode === 'debug') void chrome.runtime.sendMessage({ type: 'ROVER_DEBUG_SUBSCRIBE', enabled: false });
  if (next === 'queue' || next === 'learn') {
    if (current) {
      await chrome.runtime.sendMessage({ type: 'ROVER_CANCEL' });
      render(null);
    }
  } else {
    const response = await chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_CLEAR' });
    if (!response?.ok) {
      queueStatus.textContent = response?.error ?? 'Could not clear queue.';
      return;
    }
    renderQueue(null);
  }
  mode = next;
  manualMode.classList.toggle('active', mode === 'manual');
  queueMode.classList.toggle('active', mode === 'queue');
  learnMode.classList.toggle('active', mode === 'learn');
  debugMode.classList.toggle('active', mode === 'debug');
  manualMode.setAttribute('aria-selected', String(mode === 'manual'));
  queueMode.setAttribute('aria-selected', String(mode === 'queue'));
  learnMode.setAttribute('aria-selected', String(mode === 'learn'));
  debugMode.setAttribute('aria-selected', String(mode === 'debug'));
  const visibility = modeVisibility(mode, Boolean(current));
  catalog.hidden = !visibility.catalog;
  session.hidden = !visibility.session;
  queuePanel.hidden = !visibility.queue;
  debugPanel.hidden = !visibility.debug;
  learnPanel.hidden = mode !== 'learn';
  statusRow.hidden = mode !== 'manual';
  responseTray.hidden = mode !== 'manual';
  if (mode === 'queue') renderQueue(currentQueue);
  if (mode === 'debug') {
    await refreshDebug(true);
    await chrome.runtime.sendMessage({ type: 'ROVER_DEBUG_SUBSCRIBE', enabled: true });
  }
}

function renderQueue(queue: RoverQueueState | null): void {
  currentQueue = queue;
  if (!queue) {
    queueItems.replaceChildren();
    queueStatus.textContent = 'Queue mode requires a supported or learned browser provider page.';
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

function appendDebugGroup(title: string, entries: Array<{ label: string; state: 'pass' | 'fail' | 'unknown'; detail: string }>): void {
  const group = document.createElement('div');
  group.className = 'debug-group';
  const heading = document.createElement('div');
  heading.className = 'debug-group-title';
  heading.textContent = title;
  group.append(heading);
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'debug-indicator';
    row.dataset.state = entry.state;
    const dot = document.createElement('span');
    dot.className = 'debug-indicator-dot';
    dot.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'debug-indicator-label';
    label.textContent = entry.label;
    const detail = document.createElement('div');
    detail.className = 'debug-indicator-detail';
    detail.textContent = entry.detail;
    copy.append(label, detail);
    row.append(dot, copy);
    group.append(row);
  }
  debugIndicators.append(group);
}

function renderDebug(snapshot: DebugSnapshot): void {
  debugUpdated.textContent = `Last changed ${new Date(snapshot.checkedAt).toLocaleTimeString()}`;
  debugIndicators.replaceChildren();
  appendDebugGroup('MCPLab endpoint', [{
    label: snapshot.endpoint.connected ? 'Connected' : 'Disconnected',
    state: snapshot.endpoint.connected ? 'pass' : 'fail',
    detail: snapshot.endpoint.error ? `${snapshot.endpoint.origin}: ${snapshot.endpoint.error}` : snapshot.endpoint.origin
  }]);
  appendDebugGroup('Current page', [
    {
      label: snapshot.page.matched ? `Matched ${snapshot.page.provider ?? 'provider'}` : 'Page not matched',
      state: snapshot.page.matched ? 'pass' : 'fail',
      detail: snapshot.page.error ?? snapshot.page.url ?? 'No active page'
    },
    { label: 'Active tab', state: snapshot.page.tabId === undefined ? 'unknown' : 'pass', detail: snapshot.page.tabId === undefined ? 'Unavailable' : `Tab ${snapshot.page.tabId}` }
  ]);
  if (snapshot.page.profile) {
    appendDebugGroup('Loaded provider profile', [
      { label: snapshot.page.profile.name, state: 'pass', detail: `Source: ${snapshot.page.profile.source}` },
      { label: 'Revision', state: 'pass', detail: snapshot.page.profile.revision },
      { label: 'Capabilities', state: 'pass', detail: snapshot.page.profile.capabilities.join(', ') }
    ]);
  }
  appendDebugGroup('Expected elements', snapshot.elements.length
    ? snapshot.elements.map((element: DebugElementCheck) => ({
      label: element.label,
      state: element.present ? 'pass' as const : 'fail' as const,
      detail: element.present ? element.detail : `${element.detail}${element.selector ? ` (${element.selector})` : ''}`
    }))
    : [{ label: 'Provider checks', state: 'unknown' as const, detail: 'No matching provider adapter' }]);
  appendDebugGroup('Rover state', [
    { label: 'Manual session', state: snapshot.rover.manualStatus ? 'pass' : 'unknown', detail: snapshot.rover.manualStatus ?? 'None' },
    { label: 'Queue', state: snapshot.rover.queueStatus ? 'pass' : 'unknown', detail: snapshot.rover.queueStatus ? `${snapshot.rover.queueStatus}${snapshot.rover.activeQueueItem ? `, ${snapshot.rover.activeQueueItem}` : ''}` : 'None' }
  ]);
}

async function refreshDebug(checkEndpoint = true): Promise<void> {
  if (mode !== 'debug' || debugRequestInFlight) return;
  debugRequestInFlight = true;
  if (!lastDebugFingerprint) debugUpdated.textContent = 'Checking…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'ROVER_GET_DEBUG', origin: origin.value, checkEndpoint });
    if (response?.endpoint && response?.page && response?.rover) {
      const incoming = response as DebugSnapshot;
      const snapshot = incoming.endpoint.checked || !lastDebugSnapshot
        ? incoming
        : { ...incoming, endpoint: lastDebugSnapshot.endpoint };
      lastDebugSnapshot = snapshot;
      const fingerprint = debugFingerprint(snapshot);
      if (fingerprint !== lastDebugFingerprint) {
        lastDebugFingerprint = fingerprint;
        renderDebug(snapshot);
      }
    }
    else debugUpdated.textContent = response?.error ?? 'Could not collect diagnostics.';
  } catch (error) {
    debugUpdated.textContent = error instanceof Error ? error.message : 'Could not collect diagnostics.';
  } finally {
    debugRequestInFlight = false;
  }
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
  const manualVisible = mode === 'manual';
  outcome.hidden = !manualVisible || state?.status !== 'completed';
  checks.hidden = !manualVisible || state?.status !== 'completed';
  result.hidden = !manualVisible || !state?.text;
  openResult.hidden = !manualVisible || state?.status !== 'completed';
  reset.hidden = !manualVisible || !state || !['completed', 'error'].includes(state.status);
  stop.hidden = !manualVisible || !state || ['completed', 'error'].includes(state.status);
  run.hidden = !manualVisible || state?.status !== 'ready';
  copyPrompt.hidden = !manualVisible || state?.status !== 'manual';
  manualAnswer.hidden = !manualVisible || state?.status !== 'manual';
  evaluate.hidden = !manualVisible || state?.status !== 'manual';

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

chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message.type === 'ROVER_DEBUG_CHANGED' && mode === 'debug') void refreshDebug(false);
  if (message.type === 'ROVER_LEARN_RESULT') {
    const event = message as { draft?: BrowserProviderLearningDraft };
    if (!event.draft) return;
    learningDraft = event.draft;
    void chrome.storage.local.set({ [LEARNING_DRAFT_KEY]: event.draft });
    learnStart.textContent = 'Start learning again';
    learnStatus.textContent = 'Sample captured. Review the capabilities, name the provider, and save it.';
    learnName.hidden = false;
    learnSave.hidden = false;
    learnCapabilities.replaceChildren(...event.draft.capabilities.map((capability) => {
      const item = document.createElement('span');
      item.className = 'debug-indicator';
      item.textContent = `${capability.label}: ${capability.confidence}`;
      return item;
    }));
  }
});

void chrome.runtime.sendMessage({ type: 'ROVER_GET_STATE' }).then((state: RoverState | null) => {
  if (state) render(state);
  void loadCatalog(state?.origin);
  reportPanelSize();
});
void chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_GET' }).then((queue: RoverQueueState | null) => {
  renderQueue(queue);
  if (queue) void setMode('queue');
  else queueMode.click();
});
void chrome.storage.local.get(LEARNING_DRAFT_KEY).then((stored) => {
  const draft = stored[LEARNING_DRAFT_KEY] as BrowserProviderLearningDraft | undefined;
  if (!draft) return;
  learningDraft = draft;
  learnName.value = draft.profile.name;
  learnName.hidden = false;
  learnSave.hidden = false;
  learnStatus.textContent = 'A saved learning draft is ready to review.';
  learnCapabilities.replaceChildren(...draft.capabilities.map((capability) => {
    const item = document.createElement('span');
    item.className = 'debug-indicator';
    item.textContent = `${capability.label}: ${capability.confidence}`;
    return item;
  }));
});
