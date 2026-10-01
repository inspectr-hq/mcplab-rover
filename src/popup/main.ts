import type {
  BrowserProviderDiscoveryDraft,
  BrowserProviderDiscoveryProgress,
  DebugElementCheck,
  DebugSnapshot,
  RoverState
} from '../contracts';
import type { BrowserProviderProfile, LiveTestCatalogItem } from '../mcplab/types';
import type { RoverQueueState } from '../queue/state';
import {
  debugFingerprint,
  buildLearnedProviderSave,
  debugCheckedLabel,
  filterTestCases,
  formatCheckCounts,
  managedPhaseLabel,
  learnResultStatus,
  modeVisibility,
  profileSummary,
  projectQueueForProvider,
  suggestedProviderName
} from './view-model';
import './style.css';

const shell = document.querySelector<HTMLElement>('.shell')!;
const provider = document.querySelector<HTMLParagraphElement>('#provider')!;
const origin = document.querySelector<HTMLInputElement>('#origin')!;
const connect = document.querySelector<HTMLButtonElement>('#connect')!;
const connectionSettings = document.querySelector<HTMLButtonElement>('#connection-settings')!;
const connectionControls = document.querySelector<HTMLDivElement>('#connection-controls')!;
const connectionPreferences = document.querySelector<HTMLDivElement>('#connection-preferences')!;
const debugLogging = document.querySelector<HTMLInputElement>('#debug-logging')!;
const DEBUG_LOGGING_KEY = 'rover.debugLogging';
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
const newConversation = document.querySelector<HTMLButtonElement>('#new-conversation')!;
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
const learnTarget = document.querySelector<HTMLElement>('#learn-target')!;
const learnStatus = document.querySelector<HTMLParagraphElement>('#learn-status')!;
const learnProgress = document.querySelector<HTMLElement>('#learn-progress')!;
const learnEvidenceSection = document.querySelector<HTMLElement>('#learn-evidence-section')!;
const learnCapabilities = document.querySelector<HTMLElement>('#learn-capabilities')!;
const learnProposalSection = document.querySelector<HTMLElement>('#learn-proposal-section')!;
const learnProposal = document.querySelector<HTMLElement>('#learn-proposal')!;
const learnValidationSection = document.querySelector<HTMLElement>('#learn-validation-section')!;
const learnValidation = document.querySelector<HTMLElement>('#learn-validation')!;
const learnName = document.querySelector<HTMLInputElement>('#learn-name')!;
const learnStart = document.querySelector<HTMLButtonElement>('#learn-start')!;
const learnCapture = document.querySelector<HTMLButtonElement>('#learn-capture')!;
const learnPropose = document.querySelector<HTMLButtonElement>('#learn-propose')!;
const learnSave = document.querySelector<HTMLButtonElement>('#learn-save')!;
const debugPanel = document.querySelector<HTMLElement>('#debug-panel')!;
const debugRefresh = document.querySelector<HTMLButtonElement>('#debug-refresh')!;
const debugUpdated = document.querySelector<HTMLParagraphElement>('#debug-updated')!;
const debugIndicators = document.querySelector<HTMLElement>('#debug-indicators')!;

let items: LiveTestCatalogItem[] = [];
let current: RoverState | null = null;
let currentQueue: RoverQueueState | null = null;
let activeProvider: string | undefined;
let activeProviderProfile: BrowserProviderProfile | undefined;
let activeTabUrl: string | undefined;
let learnTargets: Array<{ id: string; name: string }> = [];
let selectedLearnTargetId: string | undefined;
let activeProviderSupportsNewConversation = false;
let mode: 'manual' | 'queue' | 'learn' | 'debug' = 'manual';
let discoveryDraft: BrowserProviderDiscoveryDraft | null = null;
const DISCOVERY_DRAFT_KEY = 'rover.provider-discovery-draft';
const LEGACY_LEARNING_DRAFT_KEY = 'rover.learning-draft';
let lastDebugFingerprint = '';
let debugRequestInFlight = false;
let lastDebugSnapshot: DebugSnapshot | null = null;
let modeTransitionInFlight = false;

async function runButtonAction(
  button: HTMLButtonElement,
  action: () => Promise<void>
): Promise<void> {
  if (button.disabled) return;
  button.disabled = true;
  try {
    await action();
  } finally {
    button.disabled = false;
  }
}

async function runModeTransition(action: () => Promise<void>): Promise<void> {
  if (modeTransitionInFlight) return;
  modeTransitionInFlight = true;
  try {
    await action();
  } finally {
    modeTransitionInFlight = false;
  }
}

function setConnectionState(
  state: 'connecting' | 'connected' | 'disconnected',
  message: string
): void {
  connectionStatus.dataset.state = state;
  connectionDot.title = message;
  connectionStatus.lastElementChild!.textContent = message;
  window.parent.postMessage(
    { type: 'ROVER_CONNECTION_STATE', connected: state === 'connected' },
    '*'
  );
}

function reportPanelSize(): void {
  window.parent.postMessage(
    {
      type: 'ROVER_PANEL_SIZE',
      height: Math.ceil(Math.max(shell.scrollHeight, shell.getBoundingClientRect().height))
    },
    '*'
  );
}

if (window.parent !== window && 'ResizeObserver' in window) {
  new ResizeObserver(reportPanelSize).observe(shell);
}

connectionSettings.addEventListener('click', () => {
  const expanded = !connectionControls.hidden;
  connectionControls.hidden = expanded;
  connectionPreferences.hidden = expanded;
  connectionSettings.setAttribute('aria-expanded', String(!expanded));
});
debugLogging.addEventListener('change', () => {
  void chrome.storage.local.set({ [DEBUG_LOGGING_KEY]: debugLogging.checked });
});
newConversation.addEventListener('click', async () => {
  newConversation.disabled = true;
  newConversation.textContent = 'Starting…';
  const response = await chrome.runtime.sendMessage({ type: 'ROVER_START_NEW_CONVERSATION' });
  newConversation.disabled = false;
  newConversation.textContent = 'Start new conversation';
  if (!response?.ok) {
    status.textContent = response?.error ?? 'Could not start a new conversation.';
    return;
  }
  status.textContent = 'New conversation started.';
});
manualMode.addEventListener('click', () => void runModeTransition(() => setMode('manual')));
queueMode.addEventListener(
  'click',
  () =>
    void runModeTransition(async () => {
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
    })
);
debugMode.addEventListener('click', () => void runModeTransition(() => setMode('debug')));
learnMode.addEventListener(
  'click',
  () =>
    void runModeTransition(async () => {
      await setMode('learn');
      await refreshActiveProvider();
      await refreshLearnTargets();
    })
);
learnStart.addEventListener(
  'click',
  () =>
    void runButtonAction(learnStart, async () => {
      if (learnStart.textContent === 'Stop learning') {
        const response = await chrome.runtime.sendMessage({ type: 'ROVER_LEARN_STOP' });
        if (!response?.ok) {
          learnStatus.textContent = response?.error ?? 'Could not stop learning.';
          return;
        }
        learnStart.textContent = 'Start learning';
        learnCapture.hidden = true;
        learnProgress.hidden = true;
        learnEvidenceSection.hidden = true;
        learnStatus.textContent = 'Learning stopped. Start again when you are ready.';
        return;
      }
      discoveryDraft = null;
      learnCapabilities.replaceChildren();
      learnProgress.replaceChildren();
      learnProgress.hidden = true;
      learnEvidenceSection.hidden = false;
      learnProposal.replaceChildren();
      learnProposalSection.hidden = true;
      learnValidation.replaceChildren();
      learnValidation.hidden = true;
      learnValidationSection.hidden = true;
      learnName.hidden = true;
      learnPropose.hidden = true;
      learnSave.hidden = true;
      learnCapture.hidden = false;
      learnStart.textContent = 'Stop learning';
      learnStatus.textContent =
        'Learning is active. Send one message in the chat, then wait for the response.';
      await refreshActiveProvider();
      await refreshLearnTargets();
      if (learnTargets.length > 1 && !selectedLearnTargetId) {
        learnStart.textContent = 'Start learning';
        learnCapture.hidden = true;
        learnStatus.textContent =
          'Choose the provider profile that this Learning session should update.';
        return;
      }
      const targetProviderId = selectedLearnTargetId ?? learnTargets[0]?.id;
      const response = await chrome.runtime.sendMessage({
        type: 'ROVER_LEARN_START',
        targetProviderId
      });
      if (!response?.ok) {
        learnStatus.textContent = response?.error ?? 'Could not start learning.';
        learnStart.textContent = 'Start learning';
        learnCapture.hidden = true;
      }
    })
);
learnCapture.addEventListener(
  'click',
  () =>
    void runButtonAction(learnCapture, async () => {
      const response = await chrome.runtime.sendMessage({ type: 'ROVER_LEARN_CAPTURE' });
      if (!response?.ok) {
        learnStatus.textContent =
          response?.error ?? 'Nothing to capture yet: a composer and a response are both required.';
      }
    })
);
learnPropose.addEventListener(
  'click',
  () =>
    void runButtonAction(learnPropose, async () => {
      const draft = discoveryDraft;
      if (!draft) return;
      learnStatus.textContent = 'Asking MCPLab to review the provider lifecycle…';
      const response = await chrome.runtime.sendMessage({
        type: 'ROVER_LEARN_PROPOSE',
        profile: draft.profile,
        trace: draft.trace,
        origin: origin.value
      });
      if (discoveryDraft !== draft) return;
      if (!response?.ok) {
        learnStatus.textContent = response?.error ?? 'Could not request an MCPLab proposal.';
        return;
      }
      const replayResponse = await chrome.runtime.sendMessage({
        type: 'ROVER_LEARN_VALIDATE',
        profile: response.proposal.profile,
        trace: draft.trace
      });
      if (discoveryDraft !== draft) return;
      const replay = replayResponse?.ok
        ? replayResponse.validation
        : { passed: false, reasons: [replayResponse?.error ?? 'Could not replay the proposal.'] };
      discoveryDraft = {
        ...draft,
        capturedProfile: draft.capturedProfile ?? draft.profile,
        profile: response.proposal.profile,
        readyToSave: replay.passed,
        validationReasons: replay.reasons,
        proposalDiagnostics: {
          rationale: response.proposal.rationale ?? [],
          warnings: response.proposal.warnings ?? []
        }
      };
      await chrome.storage.local.set({ [DISCOVERY_DRAFT_KEY]: discoveryDraft });
      learnSave.hidden = discoveryDraft.readyToSave !== true;
      renderLearnCapabilities(discoveryDraft.capabilities);
      renderLearnProposal(discoveryDraft);
      renderLearnValidation(discoveryDraft);
      const rationale = Array.isArray(response.proposal.rationale)
        ? response.proposal.rationale[0]
        : undefined;
      learnStatus.textContent = replay.passed
        ? rationale
          ? `MCPLab proposal validated. ${rationale}`
          : 'MCPLab proposal validated. Review and save the provider.'
        : `MCPLab proposal rejected by browser replay. ${replay.reasons[0] ?? ''}`;
    })
);
learnSave.addEventListener(
  'click',
  () =>
    void runButtonAction(learnSave, async () => {
      if (!discoveryDraft || discoveryDraft.readyToSave !== true) {
        learnStatus.textContent =
          'The provider must pass lifecycle validation before it can be saved.';
        return;
      }
      const name = learnName.value.trim();
      if (!name) {
        learnStatus.textContent = 'Enter a provider name first.';
        return;
      }
      try {
        const saved = buildLearnedProviderSave(
          discoveryDraft.profile,
          name,
          discoveryDraft.targetProviderId,
          discoveryDraft.sourceUrl ?? activeTabUrl
        );
        const response = await chrome.runtime.sendMessage({
          type: 'ROVER_LEARN_SAVE',
          profile: saved.profile,
          agent: saved.agent,
          origin: origin.value,
          trace: discoveryDraft.trace,
          proposalDiagnostics: discoveryDraft.proposalDiagnostics
        });
        if (!response?.ok) throw new Error(response?.error ?? 'Could not save provider.');
        learnStatus.textContent = `Saved ${name} to MCPLab.`;
        learnSave.hidden = true;
        learnPropose.hidden = true;
        discoveryDraft = null;
        await chrome.storage.local.remove([DISCOVERY_DRAFT_KEY, LEGACY_LEARNING_DRAFT_KEY]);
      } catch (error) {
        learnStatus.textContent =
          error instanceof Error ? error.message : 'Could not save provider.';
      }
    })
);
debugRefresh.addEventListener('click', () => void refreshDebug(true));
queueAdd.addEventListener('click', async () => {
  await runButtonAction(queueAdd, async () => {
    const item = items.find((candidate) => candidate.id === queueEvaluation.value);
    if (!item?.eligible) return;
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_QUEUE_ADD',
      item: { id: item.id, name: item.name, prompt: '', assertionCount: item.assertionCount }
    });
    if (response?.ok) renderQueue(response.queue);
    else queueStatus.textContent = response?.error ?? 'Could not add evaluation.';
  });
});
queueNewChat.addEventListener('change', async () => {
  const response = await chrome.runtime.sendMessage({
    type: 'ROVER_QUEUE_SET_NEW_CHAT',
    enabled: queueNewChat.checked
  });
  if (response?.ok) renderQueue(response.queue);
  else queueStatus.textContent = response?.error ?? 'Could not update conversation setting.';
});
queueStart.addEventListener('click', async () => {
  await runButtonAction(queueStart, async () => {
    const response = await chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_START' });
    if (response?.ok) renderQueue(response.queue);
    else queueStatus.textContent = response?.error ?? 'Could not start queue.';
  });
});

function showQueueError(
  response: { ok?: boolean; error?: string } | undefined,
  fallback: string
): void {
  if (!response?.ok) queueStatus.textContent = response?.error ?? fallback;
}

queueRetry.addEventListener('click', async () => {
  await runButtonAction(queueRetry, async () => {
    const response = await chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_RETRY' });
    if (response?.ok) renderQueue(response.queue);
    else showQueueError(response, 'Could not retry queue item.');
  });
});
queueSkip.addEventListener('click', async () => {
  await runButtonAction(queueSkip, async () => {
    const response = await chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_SKIP' });
    if (response?.ok) renderQueue(response.queue);
    else showQueueError(response, 'Could not skip queue item.');
  });
});
queueStop.addEventListener('click', async () => {
  await runButtonAction(queueStop, async () => {
    const response = await chrome.runtime.sendMessage({ type: 'ROVER_QUEUE_STOP' });
    if (response?.ok) renderQueue(response.queue);
    else showQueueError(response, 'Could not stop queue.');
  });
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
  if (mode === 'debug')
    void chrome.runtime.sendMessage({ type: 'ROVER_DEBUG_SUBSCRIBE', enabled: false });
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
    void chrome.runtime
      .sendMessage({ type: 'ROVER_QUEUE_WAITING' })
      .then(
        (
          waiting:
            Array<{ evaluationName?: string; provider: string; position: number }> | undefined
        ) => {
          if (!waiting?.length || currentQueue) return;
          const first = waiting[0];
          queueStatus.textContent = `${waiting.length} evaluation${waiting.length === 1 ? '' : 's'} waiting for ${first.provider} on MCPLab. Switch providers if needed.`;
        }
      );
    queueStart.disabled = true;
    queueRetry.hidden = true;
    queueSkip.hidden = true;
    queueStop.hidden = true;
    queueStart.hidden = false;
    return;
  }
  const providerForView = activeProvider ?? queue.provider;
  const { active, completed, managed, matchesCurrentAssignment } = projectQueueForProvider(
    queue,
    providerForView
  );
  const addRow = queueEvaluation.closest('.queue-add-row') as HTMLElement | null;
  const editable = !managed && matchesCurrentAssignment;
  addRow?.toggleAttribute('hidden', !editable);
  queueNewChat.closest('.checkbox-row')?.toggleAttribute('hidden', !editable);
  queueNewChat.checked = queue.newConversationBetweenItems;
  const renderGroup = (
    title: string,
    items: RoverQueueState['items'],
    editable: boolean,
    history = false
  ): HTMLElement => {
    const group = document.createElement('section');
    group.className = 'queue-group';
    const heading = document.createElement('strong');
    heading.className = 'queue-group-title';
    heading.textContent = `${title} (${items.length})`;
    group.append(heading);
    const rows = items.map((item, index) => {
      const row = document.createElement('div');
      row.className = 'queue-item';
      const name = document.createElement('span');
      name.className = 'queue-item-name';
      const queueIndex = queue.items.findIndex(
        (candidate) => candidate.queueItemId === item.queueItemId
      );
      name.textContent = `${queueIndex + 1}. ${item.name}`;
      const itemStatus = document.createElement('span');
      itemStatus.className = 'queue-item-status';
      itemStatus.dataset.status = item.status;
      itemStatus.textContent =
        item.status === 'running'
          ? ''
          : item.status === 'passed'
            ? '✓'
            : item.status === 'failed'
              ? '✕'
              : item.status;
      if (item.status === 'running' || item.status === 'passed' || item.status === 'failed') {
        const label =
          item.status === 'running' ? 'Running' : item.status === 'passed' ? 'Passed' : 'Failed';
        itemStatus.setAttribute('role', 'img');
        itemStatus.setAttribute('aria-label', label);
        itemStatus.title = label;
      }
      row.append(itemStatus, name);
      if (editable) {
        for (const [action, label] of [
          ['up', '↑'],
          ['down', '↓'],
          ['remove', '×']
        ] as const) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = label;
          button.title = action;
          button.disabled =
            item.status !== 'queued' ||
            (action === 'up' && index === 0) ||
            (action === 'down' && index === items.length - 1);
          button.addEventListener('click', () => {
            if (button.disabled) return;
            button.disabled = true;
            void chrome.runtime
              .sendMessage({
                type: action === 'remove' ? 'ROVER_QUEUE_REMOVE' : 'ROVER_QUEUE_MOVE',
                queueItemId: item.queueItemId,
                ...(action === 'remove' ? {} : { direction: action })
              })
              .then((response) => {
                if (response?.ok) renderQueue(response.queue);
                else button.disabled = false;
              })
              .catch(() => {
                button.disabled = false;
              });
          });
          row.append(button);
        }
      }
      if (history) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'queue-history-remove';
        button.innerHTML = `<svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h12M6 6V3h6v3M4 6l1 9h8l1-9M7 8v5M11 8v5"/></svg>`;
        button.title = `Remove ${item.name} from Rover history`;
        button.setAttribute('aria-label', button.title);
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const response = await chrome.runtime.sendMessage({
              type: 'ROVER_QUEUE_DISMISS_HISTORY',
              provider: providerForView,
              queueItemId: item.queueItemId
            });
            if (!response?.ok)
              throw new Error(response?.error ?? 'Could not remove history entry.');
            renderQueue(response.queue);
          } catch (error) {
            queueStatus.textContent =
              error instanceof Error ? error.message : 'Could not remove history entry.';
            button.disabled = false;
          }
        });
        row.append(button);
      }
      if (item.resultUrl) {
        const link = document.createElement('a');
        link.className = 'queue-result-link';
        link.href = `${queue.origin}${item.resultUrl}`;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = 'View result';
        row.append(link);
      }
      return row;
    });
    group.append(...rows);
    return group;
  };
  const groups: HTMLElement[] = [];
  if (active.length)
    groups.push(renderGroup(managed ? `${queue.provider} queue` : 'Up next', active, editable));
  if (completed.length)
    groups.push(renderGroup(`Recent ${providerForView} evaluations`, completed, false, true));
  queueItems.replaceChildren(...groups);
  queueItems.parentElement?.classList.toggle('queue-managed', managed);
  queueStart.hidden = !editable;
  const readyForNextEvaluation =
    (queue.status === 'completed' || queue.status === 'stopped') &&
    !queue.leaseId &&
    !queue.pendingLeaseActions?.length;
  const phaseLabel = managedPhaseLabel(readyForNextEvaluation ? 'terminal' : queue.managedPhase);
  queueStatus.textContent = readyForNextEvaluation
    ? `${phaseLabel}.`
    : !matchesCurrentAssignment && managed
      ? `Assignment received for ${queue.provider}. Switch to a matching page to run it (${queue.items.filter((item) => item.status !== 'queued').length}/${queue.items.length} processed).`
      : !matchesCurrentAssignment
        ? `Switch to ${queue.provider} to edit or run this queue.`
        : managed && phaseLabel
          ? `${phaseLabel}${queue.managedPhase === 'waiting_ack' ? '.' : '...'}`
          : queue.status === 'paused'
            ? `Paused: ${queue.error?.message ?? 'Queue needs attention.'}`
            : queue.status === 'completed'
              ? 'Queue completed.'
              : queue.status === 'stopped'
                ? 'Queue stopped.'
                : `${queue.items.filter((item) => item.status !== 'queued').length}/${queue.items.length} evaluations processed.`;
  queueStart.disabled =
    queue.items.length === 0 || queue.status === 'running' || queue.status === 'paused';
  queueRetry.hidden = queue.status !== 'paused';
  queueSkip.hidden = queue.status !== 'paused';
  queueStop.hidden = !['running', 'paused'].includes(queue.status);
}

async function refreshActiveProvider(retry = true): Promise<void> {
  provider.textContent = 'Checking this tab for a supported chat…';
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'ROVER_GET_ACTIVE_PROVIDER' })) as
      | {
          provider?: string;
          profile?: BrowserProviderProfile;
          url?: string;
          supportsNewConversation?: boolean;
          error?: string;
        }
      | undefined;
    activeProvider = response?.provider;
    activeProviderProfile = response?.profile;
    activeTabUrl = response?.url;
    const providerName = activeProviderProfile?.name ??
      (activeProvider === 'claude' ? 'Claude' : activeProvider === 'chatgpt-com' ? 'ChatGPT' : activeProvider);
    provider.textContent = !response || response.error
      ? 'Could not check this tab. Try reopening Rover.'
      : activeProvider
        ? `Active chat: ${providerName}`
        : 'No supported chat detected on this tab';
    renderLearnTarget();
    const builtInSupport = response?.provider === 'claude' || response?.provider === 'chatgpt-com';
    activeProviderSupportsNewConversation =
      response?.supportsNewConversation === true || builtInSupport;
    newConversation.hidden = !activeProviderSupportsNewConversation;
    if (mode === 'queue') renderQueue(currentQueue);
  } catch {
    // Provider detection can race popup startup while the content script is loading.
    // Retry once after the content script has had time to initialize.
    if (retry) window.setTimeout(() => void refreshActiveProvider(false), 500);
    else provider.textContent = 'Could not check this tab. Try reopening Rover.';
  }
}

async function refreshLearnTargets(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: 'ROVER_GET_LEARN_TARGETS'
  })) as { targets?: Array<{ id: string; name: string }>; url?: string } | undefined;
  learnTargets = response?.targets ?? [];
  activeTabUrl = response?.url ?? activeTabUrl;
  selectedLearnTargetId = learnTargets.length === 1 ? learnTargets[0]?.id : selectedLearnTargetId;
  renderLearnTarget();
}

function renderLearnTarget(): void {
  if (learnTargets.length > 1) {
    learnTarget.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = 'Learning target';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Learning provider profile');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a provider profile…';
    placeholder.selected = !selectedLearnTargetId;
    select.append(
      placeholder,
      ...learnTargets.map((target) => {
        const option = document.createElement('option');
        option.value = target.id;
        option.textContent = `${target.name} (${target.id})`;
        option.selected = target.id === selectedLearnTargetId;
        return option;
      })
    );
    select.addEventListener('change', () => {
      selectedLearnTargetId = select.value;
      renderLearnTarget();
    });
    learnTarget.append(title, document.createElement('br'), select);
    return;
  }
  if (learnTargets.length === 0) {
    learnTarget.textContent = 'Learning target: create a new provider profile.';
    return;
  }
  learnTarget.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = 'Learning target';
  const detail = document.createElement('span');
  const target = learnTargets[0];
  detail.textContent = `Updating ${target?.name ?? activeProviderProfile?.name ?? activeProvider} (${target?.id ?? activeProvider}).`;
  learnTarget.append(title, document.createElement('br'), detail);
}

function renderCatalog(): void {
  const selectedTestCaseId = testCase.value;
  const selectedQueueEvaluationId = queueEvaluation.value;
  const visible = filterTestCases(items, search.value);
  testCase.replaceChildren(
    ...visible.map((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `${item.name}${item.eligible ? '' : ' (unsupported)'}`;
      return option;
    })
  );
  queueEvaluation.replaceChildren(
    ...visible.map((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `${item.name}${item.eligible ? '' : ' (unsupported)'}`;
      option.disabled = !item.eligible;
      return option;
    })
  );
  if (visible.some((item) => item.id === selectedTestCaseId)) testCase.value = selectedTestCaseId;
  if (visible.some((item) => item.id === selectedQueueEvaluationId))
    queueEvaluation.value = selectedQueueEvaluationId;
  updateSelection();
}

function updateSelection(): void {
  const item = selectedItem();
  prepare.disabled = !item?.eligible;
  selectionNote.textContent =
    item?.ineligibleReason ?? (item ? `${item.assertionCount} checks` : 'Select a test case.');
}

function createIndicatorRow(entry: {
  label: string;
  state: 'pass' | 'fail' | 'unknown';
  detail: string;
}): HTMLDivElement {
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
  return row;
}

function renderIndicatorList(
  container: HTMLElement,
  entries: Array<{ label: string; state: 'pass' | 'fail' | 'unknown'; detail: string }>
): void {
  container.replaceChildren(...entries.map(createIndicatorRow));
}

function appendDebugGroup(
  title: string,
  entries: Array<{ label: string; state: 'pass' | 'fail' | 'unknown'; detail: string }>
): void {
  const group = document.createElement('div');
  group.className = 'debug-group';
  const heading = document.createElement('div');
  heading.className = 'debug-group-title';
  heading.textContent = title;
  group.append(heading);
  for (const entry of entries) group.append(createIndicatorRow(entry));
  debugIndicators.append(group);
}

function renderDebug(snapshot: DebugSnapshot): void {
  debugUpdated.textContent = debugCheckedLabel(snapshot.checkedAt);
  debugIndicators.replaceChildren();
  appendDebugGroup('MCPLab endpoint', [
    {
      label: snapshot.endpoint.connected ? 'Connected' : 'Disconnected',
      state: snapshot.endpoint.connected ? 'pass' : 'fail',
      detail: snapshot.endpoint.error
        ? `${snapshot.endpoint.origin}: ${snapshot.endpoint.error}`
        : snapshot.endpoint.origin
    }
  ]);
  appendDebugGroup('Current page', [
    {
      label: snapshot.page.matched
        ? `Matched ${snapshot.page.provider ?? 'provider'}`
        : 'Page not matched',
      state: snapshot.page.matched ? 'pass' : 'fail',
      detail: snapshot.page.error ?? snapshot.page.url ?? 'No active page'
    },
    {
      label: 'Active tab',
      state: snapshot.page.tabId === undefined ? 'unknown' : 'pass',
      detail: snapshot.page.tabId === undefined ? 'Unavailable' : `Tab ${snapshot.page.tabId}`
    },
    ...(snapshot.page.detection
      ? [
          {
            label: 'Detection attempts',
            state: snapshot.page.detection.provider ? ('pass' as const) : ('fail' as const),
            detail: `${snapshot.page.detection.attempts} attempt(s), last checked ${new Date(snapshot.page.detection.checkedAt).toLocaleTimeString()}${snapshot.page.detection.error ? `, ${snapshot.page.detection.error}` : ''}`
          }
        ]
      : [])
  ]);
  if (snapshot.page.profile) {
    appendDebugGroup('Loaded provider profile', [
      {
        label: snapshot.page.profile.name,
        state: 'pass',
        detail: `Source: ${snapshot.page.profile.source}`
      },
      { label: 'Revision', state: 'pass', detail: snapshot.page.profile.revision },
      {
        label: 'Capabilities',
        state: 'pass',
        detail: snapshot.page.profile.capabilities.join(', ')
      }
    ]);
  }
  appendDebugGroup(
    'Expected elements',
    snapshot.elements.length
      ? snapshot.elements.map((element: DebugElementCheck) => ({
          label: element.label,
          state: element.present ? ('pass' as const) : ('fail' as const),
          detail: element.present
            ? element.detail
            : `${element.detail}${element.selector ? ` (${element.selector})` : ''}`
        }))
      : [
          {
            label: 'Provider checks',
            state: 'unknown' as const,
            detail: 'No matching provider adapter'
          }
        ]
  );
  appendDebugGroup('Rover state', [
    {
      label: 'Manual session',
      state: snapshot.rover.manualStatus ? 'pass' : 'unknown',
      detail: snapshot.rover.manualStatus ?? 'None'
    },
    {
      label: 'Queue',
      state: snapshot.rover.queueStatus ? 'pass' : 'unknown',
      detail: snapshot.rover.queueStatus
        ? `${snapshot.rover.queueStatus}${snapshot.rover.activeQueueItem ? `, ${snapshot.rover.activeQueueItem}` : ''}`
        : 'None'
    },
    {
      label: 'Lease',
      state: snapshot.rover.leaseId ? 'pass' : 'unknown',
      detail: snapshot.rover.leaseId
        ? `${snapshot.rover.leaseState ?? 'unknown'} (${snapshot.rover.leaseId})`
        : 'None'
    },
    ...(snapshot.rover.leaseExpiresAt
      ? [
          {
            label: 'Lease expiry',
            state: 'unknown' as const,
            detail: snapshot.rover.leaseExpiresAt
          }
        ]
      : []),
    ...(snapshot.rover.lastLeaseRenewalAt
      ? [
          {
            label: 'Last renewal',
            state: 'pass' as const,
            detail: snapshot.rover.lastLeaseRenewalAt
          }
        ]
      : []),
    ...(snapshot.rover.boundTabId === undefined
      ? []
      : [
          { label: 'Bound tab', state: 'pass' as const, detail: `Tab ${snapshot.rover.boundTabId}` }
        ]),
    ...(snapshot.rover.lastAssignmentDecision
      ? [
          {
            label: 'Assignment decision',
            state: 'pass' as const,
            detail: `${snapshot.rover.lastAssignmentDecision.decision}${snapshot.rover.lastAssignmentDecision.reason ? `, ${snapshot.rover.lastAssignmentDecision.reason}` : ''}`
          }
        ]
      : [])
  ]);
}

async function refreshDebug(checkEndpoint = true): Promise<void> {
  if (mode !== 'debug' || debugRequestInFlight) return;
  debugRequestInFlight = true;
  if (!lastDebugFingerprint) debugUpdated.textContent = 'Checking…';
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_GET_DEBUG',
      origin: origin.value,
      checkEndpoint
    });
    if (response?.endpoint && response?.page && response?.rover) {
      const incoming = response as DebugSnapshot;
      const snapshot =
        incoming.endpoint.checked || !lastDebugSnapshot
          ? incoming
          : { ...incoming, endpoint: lastDebugSnapshot.endpoint };
      lastDebugSnapshot = snapshot;
      const fingerprint = debugFingerprint(snapshot);
      if (fingerprint !== lastDebugFingerprint) {
        lastDebugFingerprint = fingerprint;
        renderDebug(snapshot);
      }
    } else debugUpdated.textContent = response?.error ?? 'Could not collect diagnostics.';
  } catch (error) {
    debugUpdated.textContent =
      error instanceof Error ? error.message : 'Could not collect diagnostics.';
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
    status.textContent = items.length ? 'Choose a test case' : 'Ready';
    return;
  }
  testName.textContent = state.testCaseName;
  prompt.textContent = state.prompt;
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
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_GET_CATALOG',
      origin: requestedOrigin
    });
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
  await runButtonAction(prepare, async () => {
    const item = selectedItem();
    if (!item?.eligible) return;
    status.textContent = 'Preparing Live Test…';
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_PREPARE',
      testCaseId: item.id,
      origin: origin.value
    });
    if (!response?.ok)
      status.textContent = `Error: ${response?.error ?? 'Could not prepare Live Test.'}`;
    else render(response.state);
  });
});

run.addEventListener('click', async () => {
  await runButtonAction(run, async () => {
    const response = await chrome.runtime.sendMessage({ type: 'ROVER_EXECUTE' });
    if (!response?.ok)
      status.textContent = `Error: ${response?.error ?? 'Could not run Live Test.'}`;
    else render(response.state);
  });
});

stop.addEventListener('click', async () => {
  await runButtonAction(stop, async () => {
    status.textContent = 'Stopping Live Test…';
    await chrome.runtime.sendMessage({ type: 'ROVER_CANCEL' });
    manualAnswer.value = '';
    render(null);
    await loadCatalog(origin.value);
  });
});

copyPrompt.addEventListener('click', async () => {
  await navigator.clipboard.writeText(current?.prompt ?? '');
  status.textContent = 'Prompt copied. Paste it into your agent.';
});

evaluate.addEventListener('click', async () => {
  await runButtonAction(evaluate, async () => {
    if (!manualAnswer.value.trim()) {
      status.textContent = 'Paste the final answer first.';
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_COMPLETE_MANUAL',
      text: manualAnswer.value
    });
    if (!response?.ok)
      status.textContent = `Evaluation error: ${response?.error ?? 'Could not evaluate answer.'}`;
    else render(response.state);
  });
});

openResult.addEventListener('click', async () => {
  if (current?.resultUrl)
    await chrome.tabs.create({ url: `${current.origin}${current.resultUrl}` });
});

reset.addEventListener(
  'click',
  () =>
    void runButtonAction(reset, async () => {
      await chrome.runtime.sendMessage({ type: 'ROVER_CANCEL' });
      manualAnswer.value = '';
      render(null);
      await loadCatalog(origin.value);
    })
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes['rover.run'])
    render(changes['rover.run'].newValue as RoverState | null);
  if (area === 'session' && changes['rover.queue'])
    renderQueue(changes['rover.queue'].newValue as RoverQueueState | null);
});

function confidenceState(confidence: 'high' | 'medium' | 'low'): 'pass' | 'fail' | 'unknown' {
  return confidence === 'high' ? 'pass' : confidence === 'medium' ? 'unknown' : 'fail';
}

function renderLearnCapabilities(
  capabilities: BrowserProviderDiscoveryDraft['capabilities']
): void {
  learnEvidenceSection.hidden = false;
  renderIndicatorList(
    learnCapabilities,
    capabilities.map((capability) => ({
      label: capability.label,
      state: confidenceState(capability.confidence),
      detail: capability.detail
    }))
  );
}

function renderLearnProposal(draft: BrowserProviderDiscoveryDraft): void {
  if (!draft.capturedProfile) {
    learnProposal.replaceChildren();
    learnProposalSection.hidden = true;
    return;
  }
  const captured = new Map(
    profileSummary(draft.capturedProfile).map((entry) => [entry.label, entry.value])
  );
  const proposal = profileSummary(draft.profile);
  renderIndicatorList(
    learnProposal,
    proposal.map((entry) => {
      const previous = captured.get(entry.label);
      if (previous === entry.value)
        return {
          label: `${entry.label}, kept`,
          state: 'pass' as const,
          detail: `Rover's captured configuration was retained, ${entry.value}.`
        };
      if (!previous || previous === 'not configured')
        return {
          label: `${entry.label}, added by MCPLab`,
          state: 'unknown' as const,
          detail: `${entry.value}. Verify this against the captured trace.`
        };
      return {
        label: `${entry.label}, changed by MCPLab`,
        state: 'unknown' as const,
        detail: `From ${previous} to ${entry.value}. Verify this against the captured trace.`
      };
    })
  );
  learnProposalSection.hidden = false;
}

function renderLearnValidation(draft: BrowserProviderDiscoveryDraft): void {
  const reasons = draft.validationReasons ?? [];
  renderIndicatorList(learnValidation, [
    {
      label: 'Save readiness',
      state: draft.readyToSave ? 'pass' : 'fail',
      detail: draft.readyToSave
        ? 'All required lifecycle checks passed.'
        : 'Provider cannot be saved until the failed checks are resolved.'
    },
    ...reasons.map((reason) => ({
      label: 'Validation issue',
      state: 'fail' as const,
      detail: reason
    }))
  ]);
  learnValidation.hidden = false;
  learnValidationSection.hidden = false;
}

function renderLearnProgress(progress: BrowserProviderDiscoveryProgress): void {
  learnEvidenceSection.hidden = false;
  learnProgress.hidden = false;
  renderIndicatorList(learnProgress, [
    {
      label: 'Composer',
      state: progress.composerDetected ? 'pass' : 'unknown',
      detail: progress.composerDetected
        ? 'Detected the message input.'
        : 'Waiting to detect the message input…'
    },
    {
      label: 'Submit',
      state: progress.submitDetected ? 'pass' : 'unknown',
      detail: progress.submitDetected
        ? 'Detected how prompts are sent.'
        : 'Waiting for you to send a message…'
    },
    {
      label: 'Response',
      state: progress.assistantDetected ? 'pass' : 'unknown',
      detail: progress.assistantPreview
        ? `"${progress.assistantPreview}"`
        : 'Waiting for a response…'
    },
    {
      label: 'Generating signal',
      state: progress.generatingObserved ? 'pass' : 'unknown',
      detail: progress.generatingObserved
        ? 'Observed an active generation state.'
        : 'Not yet observed — this is fine if the response already finished.'
    },
    {
      label: 'Idle signal',
      state: progress.idleObserved ? 'pass' : 'unknown',
      detail: progress.idleObserved ? 'Observed the response finishing.' : 'Not yet observed.'
    }
  ]);
}

chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message.type === 'ROVER_ACTIVE_PROVIDER_CHANGED') void refreshActiveProvider();
  if (message.type === 'ROVER_DEBUG_CHANGED' && mode === 'debug') void refreshDebug(false);
  if (message.type === 'ROVER_LEARN_PROGRESS') {
    const event = message as { progress?: BrowserProviderDiscoveryProgress };
    if (event.progress) renderLearnProgress(event.progress);
  }
  if (message.type === 'ROVER_LEARN_RESULT') {
    const event = message as { draft?: BrowserProviderDiscoveryDraft };
    if (!event.draft) return;
    discoveryDraft = {
      ...event.draft,
      targetProviderId: event.draft.targetProviderId ?? selectedLearnTargetId ?? activeProvider,
      targetProviderName:
        event.draft.targetProviderName ??
        learnTargets.find(
          (target) =>
            target.id === (event.draft?.targetProviderId ?? selectedLearnTargetId ?? activeProvider)
        )?.name ??
        activeProviderProfile?.name,
      sourceUrl: event.draft.sourceUrl ?? activeTabUrl
    };
    learnName.value = discoveryDraft.targetProviderId
      ? (discoveryDraft.targetProviderName ?? discoveryDraft.profile.name)
      : suggestedProviderName(discoveryDraft.profile);
    void chrome.storage.local.set({ [DISCOVERY_DRAFT_KEY]: discoveryDraft });
    learnStart.textContent = 'Stop learning';
    learnCapture.hidden = true;
    learnProgress.hidden = true;
    learnStatus.textContent = learnResultStatus({
      readyToSave: discoveryDraft.readyToSave === true,
      hasNewConversation: Boolean(discoveryDraft.profile.newConversation),
      newConversationContextObserved: Boolean(discoveryDraft.trace?.newConversationEvidence),
      validationReason: discoveryDraft.validationReasons?.[0]
    });
    learnName.hidden = false;
    learnPropose.hidden = !discoveryDraft.trace;
    learnSave.hidden = discoveryDraft.readyToSave !== true;
    renderLearnCapabilities(discoveryDraft.capabilities);
    renderLearnProposal(discoveryDraft);
    renderLearnValidation(discoveryDraft);
  }
});

void chrome.runtime.sendMessage({ type: 'ROVER_GET_STATE' }).then((state: RoverState | null) => {
  if (state) render(state);
  void loadCatalog(state?.origin);
  reportPanelSize();
});
void chrome.runtime
  .sendMessage({ type: 'ROVER_QUEUE_GET' })
  .then((queue: RoverQueueState | null) => {
    renderQueue(queue);
    if (queue) void setMode('queue');
    else queueMode.click();
  });
void refreshActiveProvider();
void chrome.storage.local.get(DEBUG_LOGGING_KEY).then((stored) => {
  debugLogging.checked = stored[DEBUG_LOGGING_KEY] === true;
});
void chrome.storage.local.get([DISCOVERY_DRAFT_KEY, LEGACY_LEARNING_DRAFT_KEY]).then((stored) => {
  const draft = (stored[DISCOVERY_DRAFT_KEY] ?? stored[LEGACY_LEARNING_DRAFT_KEY]) as
    BrowserProviderDiscoveryDraft | undefined;
  if (!draft) return;
  discoveryDraft = draft;
  learnName.value = draft.targetProviderId
    ? (draft.targetProviderName ?? draft.profile.name)
    : suggestedProviderName(draft.profile);
  learnName.hidden = false;
  learnCapture.hidden = true;
  learnProgress.hidden = true;
  learnPropose.hidden = !draft.trace;
  learnSave.hidden = draft.readyToSave !== true;
  learnStatus.textContent =
    draft.readyToSave === true
      ? 'A saved learning draft is ready to review.'
      : 'This learning draft did not pass lifecycle validation. Capture a new active response.';
  renderLearnCapabilities(draft.capabilities);
  renderLearnProposal(draft);
  renderLearnValidation(draft);
});
