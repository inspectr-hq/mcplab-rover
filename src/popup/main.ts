import type {
  BrowserProviderDiscoveryDraft,
  BrowserProviderDiscoveryProgress,
  DebugElementCheck,
  DebugSnapshot,
  RoverState
} from '../contracts';
import type { BrowserProviderProfile, LiveTestCatalogItem } from '../mcplab/types';
import { isManagedQueue, isQueueSettled, type RoverQueueState } from '../queue/state';
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
import { debugLog, initializeDebugLogging } from '../content-debug-logging';
import './style.css';

initializeDebugLogging();

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
const queueTakeoverNotice =
  document.querySelector<HTMLParagraphElement>('#queue-takeover-notice')!;
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
const learnGuide = document.querySelector<HTMLElement>('#learn-guide')!;
let learningProgress: BrowserProviderDiscoveryProgress | undefined;
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
const learnProposeStatus = document.querySelector<HTMLElement>('#learn-propose-status')!;
const learnSave = document.querySelector<HTMLButtonElement>('#learn-save')!;
const learnSaveWithoutNewChat = document.querySelector<HTMLButtonElement>(
  '#learn-save-without-new-chat'
)!;
const learnSaveStatus = document.querySelector<HTMLElement>('#learn-save-status')!;
const debugPanel = document.querySelector<HTMLElement>('#debug-panel')!;
const debugRefresh = document.querySelector<HTMLButtonElement>('#debug-refresh')!;
const debugUpdated = document.querySelector<HTMLParagraphElement>('#debug-updated')!;
const debugIndicators = document.querySelector<HTMLElement>('#debug-indicators')!;

let items: LiveTestCatalogItem[] = [];
let current: RoverState | null = null;
let currentQueue: RoverQueueState | null = null;
let activeProvider: string | undefined;
let activeProviderChecking = false;
let activeProviderProfile: BrowserProviderProfile | undefined;
let activeTabUrl: string | undefined;
let activeTabId: number | undefined;
let providerCheckId = 0;
let learnTargets: Array<{ id: string; name: string }> = [];
let selectedLearnTargetId: string | undefined;
let activeProviderSupportsNewConversation = false;
let mode: 'manual' | 'queue' | 'learn' | 'debug' = 'manual';
let discoveryDraft: BrowserProviderDiscoveryDraft | null = null;
const DISCOVERY_DRAFT_KEY = 'rover.provider-discovery-draft';
const LEGACY_LEARNING_DRAFT_KEY = 'rover.learning-draft';
const ACTIVE_LEARNING_STATUS = 'Learning is active. Follow the steps below in the chat.';
const OTHER_TAB_LEARNING_STATUS =
  'Learning is active. Return to the tab where learning started to continue, or stop learning here.';
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
        learnGuide.hidden = true;
        learnProgress.hidden = true;
        learnEvidenceSection.hidden = true;
        learnStatus.textContent = 'Learning stopped. Start again when you are ready.';
        return;
      }
      resetLearningDraft();
      learnEvidenceSection.hidden = false;
      learnStatus.textContent = 'Starting learning… Wait before sending a message.';
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
        return;
      }
      await chrome.storage.local.remove([DISCOVERY_DRAFT_KEY, LEGACY_LEARNING_DRAFT_KEY]);
      learnCapture.hidden = false;
      learnStart.textContent = 'Stop learning';
      learnStatus.textContent = ACTIVE_LEARNING_STATUS;
      renderLearningGuide();
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
      let reviewedDraft = draft;
      learnPropose.textContent = 'Reviewing with MCPLab AI…';
      try {
        setLearnProposalStatus('Asking MCPLab to review the provider lifecycle…');
        const response = await chrome.runtime.sendMessage({
          type: 'ROVER_LEARN_PROPOSE',
          profile: draft.profile,
          trace: draft.trace,
          origin: origin.value
        });
        if (discoveryDraft !== draft || !draftMatchesActivePage(draft)) return;
        if (!response?.ok) {
          setLearnProposalStatus(response?.error ?? 'Could not request an MCPLab proposal.');
          return;
        }
        const replayResponse = await chrome.runtime.sendMessage({
          type: 'ROVER_LEARN_VALIDATE',
          profile: response.proposal.profile,
          trace: draft.trace
        });
        if (discoveryDraft !== draft || !draftMatchesActivePage(draft)) return;
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
        reviewedDraft = discoveryDraft;
        await chrome.storage.local.set({ [DISCOVERY_DRAFT_KEY]: discoveryDraft });
        if (discoveryDraft !== reviewedDraft || !draftMatchesActivePage(reviewedDraft)) return;
        renderLearnCapabilities(discoveryDraft.capabilities);
        renderLearnProposal(discoveryDraft);
        renderLearnValidation(discoveryDraft);
        const rationale = Array.isArray(response.proposal.rationale)
          ? response.proposal.rationale[0]
          : undefined;
        setLearnProposalStatus(
          replay.passed
            ? rationale
              ? `MCPLab proposal validated. ${rationale}`
              : 'MCPLab proposal validated. Review and save the provider.'
            : `MCPLab proposal rejected by browser replay. ${replay.reasons[0] ?? ''}`
        );
      } catch (error) {
        if (discoveryDraft === reviewedDraft && draftMatchesActivePage(reviewedDraft)) {
          setLearnProposalStatus(error instanceof Error ? error.message : String(error));
        }
      } finally {
        learnPropose.textContent = 'Improve with MCPLab AI';
      }
    })
);
learnSave.addEventListener(
  'click',
  () =>
    void runButtonAction(learnSave, async () => {
      if (discoveryDraft) await saveLearningDraft(discoveryDraft);
    })
);
learnSaveWithoutNewChat.addEventListener(
  'click',
  () =>
    void runButtonAction(learnSaveWithoutNewChat, async () => {
      const draft = discoveryDraft;
      if (!draft || !canOmitUnconfirmedNewChat(draft) || !draftMatchesActivePage(draft)) return;
      if (!learnName.value.trim()) {
        setLearnSaveStatus('Enter a provider name first.');
        return;
      }
      let reviewedDraft = draft;
      try {
        setLearnSaveStatus('Validating the message flow without New Chat support…');
        // Excluding an unconfirmed capability is an explicit user choice, never a validation bypass.
        const profile = { ...draft.profile };
        delete profile.newConversation;
        const response = await chrome.runtime.sendMessage({
          type: 'ROVER_LEARN_VALIDATE',
          profile,
          trace: draft.trace
        });
        if (discoveryDraft !== draft || !draftMatchesActivePage(draft)) return;
        if (!response?.ok || !response.validation?.passed) {
          setLearnSaveStatus(
            `Cannot save yet: ${
              response?.validation?.reasons?.join(' ') ||
              response?.error ||
              'Could not validate the message flow.'
            }`
          );
          return;
        }
        const validatedDraft: BrowserProviderDiscoveryDraft = {
          ...draft,
          profile,
          readyToSave: true,
          validationReasons: []
        };
        discoveryDraft = validatedDraft;
        reviewedDraft = validatedDraft;
        await chrome.storage.local.set({ [DISCOVERY_DRAFT_KEY]: validatedDraft });
        if (discoveryDraft !== validatedDraft || !draftMatchesActivePage(validatedDraft)) return;
        renderLearnProposal(validatedDraft);
        renderLearnValidation(validatedDraft);
        await saveLearningDraft(validatedDraft, true);
      } catch (error) {
        if (discoveryDraft === reviewedDraft && draftMatchesActivePage(reviewedDraft)) {
          setLearnSaveStatus(
            error instanceof Error ? error.message : 'Could not validate provider.'
          );
        }
      }
    })
);

function setLearnSaveStatus(message: string): void {
  learnSaveStatus.textContent = message;
  learnSaveStatus.hidden = false;
}

function canOmitUnconfirmedNewChat(draft: BrowserProviderDiscoveryDraft): boolean {
  return (
    draft.readyToSave !== true &&
    draft.profile.newConversation?.action === 'click' &&
    draft.profile.newConversation.confirmation === 'context-change' &&
    !draft.trace?.newConversationEvidence
  );
}

async function saveLearningDraft(
  draft: BrowserProviderDiscoveryDraft,
  withoutNewChat = false
): Promise<void> {
  if (discoveryDraft !== draft || !draftMatchesActivePage(draft)) return;
  if (draft.readyToSave !== true) {
    setLearnSaveStatus('The provider must pass lifecycle validation before it can be saved.');
    return;
  }
  const name = learnName.value.trim();
  if (!name) {
    setLearnSaveStatus('Enter a provider name first.');
    return;
  }
  learnSave.disabled = true;
  try {
    const saved = buildLearnedProviderSave(
      draft.profile,
      name,
      draft.targetProviderId,
      draft.sourceUrl ?? activeTabUrl
    );
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_LEARN_SAVE',
      profile: saved.profile,
      agent: saved.agent,
      origin: origin.value,
      trace: draft.trace,
      proposalDiagnostics: draft.proposalDiagnostics
    });
    if (discoveryDraft !== draft || !draftMatchesActivePage(draft)) return;
    if (!response?.ok) throw new Error(response?.error ?? 'Could not save provider.');
    const message = withoutNewChat
      ? `Saved ${name} to MCPLab without New Chat support.`
      : `Saved ${name} to MCPLab.`;
    learnStatus.textContent = message;
    setLearnSaveStatus(message);
    learnSave.hidden = true;
    learnSaveWithoutNewChat.hidden = true;
    learnPropose.hidden = true;
    discoveryDraft = null;
    await chrome.storage.local.remove([DISCOVERY_DRAFT_KEY, LEGACY_LEARNING_DRAFT_KEY]);
  } catch (error) {
    if (discoveryDraft === draft && draftMatchesActivePage(draft)) {
      setLearnSaveStatus(error instanceof Error ? error.message : 'Could not save provider.');
    }
  } finally {
    if (discoveryDraft === draft && draftMatchesActivePage(draft)) learnSave.disabled = false;
  }
}

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
    learnGuide.hidden = true;
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
  queueTakeoverNotice.hidden = !queue?.droppedLocalItemNames?.length;
  queueTakeoverNotice.textContent = queue?.droppedLocalItemNames?.length
    ? `MCPLab assignment took over; removed from local queue: ${queue.droppedLocalItemNames.join(', ')}.`
    : '';
  const addRow = queueEvaluation.closest('.queue-add-row') as HTMLElement | null;
  if (!queue) {
    addRow?.toggleAttribute('hidden', true);
    queueNewChat.closest('.checkbox-row')?.toggleAttribute('hidden', true);
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
    queueStart.hidden = true;
    return;
  }
  const providerForView = activeProvider ?? queue.provider;
  const { active, completed, managed, matchesCurrentAssignment } = projectQueueForProvider(
    queue,
    providerForView
  );
  const readyForNextEvaluation = isQueueSettled(queue);
  const editable =
    Boolean(activeProvider) &&
    !activeProviderChecking &&
    matchesCurrentAssignment &&
    (queue.status === 'draft' || readyForNextEvaluation) &&
    (!managed || readyForNextEvaluation);
  addRow?.toggleAttribute('hidden', !editable);
  queueNewChat
    .closest('.checkbox-row')
    ?.toggleAttribute('hidden', !editable || queue.status !== 'draft');
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
      name.textContent = `${(history ? index : queueIndex) + 1}. ${item.name}`;
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
  queueStart.hidden = isManagedQueue(queue) || !editable || active.length === 0;
  const phaseLabel = managedPhaseLabel(readyForNextEvaluation ? 'terminal' : queue.managedPhase);
  const processedLabel = `${queue.items.filter((item) => item.status !== 'queued').length}/${queue.items.length} evaluations processed.`;
  queueStatus.textContent =
    queue.status === 'paused'
      ? `Paused: ${queue.error?.message ?? 'Queue needs attention.'}`
      : readyForNextEvaluation
        ? `${phaseLabel}.`
        : managed && phaseLabel
          ? `${phaseLabel}${queue.managedPhase === 'waiting_ack' ? '.' : '...'}`
          : queue.status === 'running'
            ? processedLabel
            : !activeProvider
              ? `Open a supported chat page for ${queue.provider} to edit or run this queue.`
              : !matchesCurrentAssignment
                ? `Switch to ${queue.provider} to edit or run this queue.`
                : queue.items.length === 0
                  ? ''
                  : processedLabel;
  queueStart.disabled =
    queue.items.length === 0 || queue.status === 'running' || queue.status === 'paused';
  queueRetry.hidden = queue.status !== 'paused';
  queueSkip.hidden = queue.status !== 'paused';
  queueStop.hidden = !['running', 'paused'].includes(queue.status);
}

function draftMatchesActivePage(draft: BrowserProviderDiscoveryDraft): boolean {
  if (!activeTabUrl) return false;
  try {
    // A saved draft belongs to its capture origin, even before that provider is supported.
    const source = draft.sourceUrl ?? draft.profile.learned.sourceOrigin;
    return new URL(source).origin === new URL(activeTabUrl).origin;
  } catch {
    return false;
  }
}

function setLearnProposalStatus(message: string): void {
  learnProposeStatus.textContent = message;
  learnProposeStatus.hidden = false;
}

function hideLearningDraft(): void {
  learnGuide.hidden = true;
  learnProposeStatus.textContent = '';
  learnProposeStatus.hidden = true;
  learnCapabilities.replaceChildren();
  learnProgress.replaceChildren();
  learnProgress.hidden = true;
  learnEvidenceSection.hidden = true;
  learnProposal.replaceChildren();
  learnProposalSection.hidden = true;
  learnValidation.replaceChildren();
  learnValidation.hidden = true;
  learnValidationSection.hidden = true;
  learnName.hidden = true;
  learnPropose.hidden = true;
  learnSave.hidden = true;
  learnSaveWithoutNewChat.hidden = true;
  learnSave.disabled = true;
  learnSaveStatus.hidden = true;
  learnSaveStatus.textContent = '';
}

function resetLearningDraft(): void {
  discoveryDraft = null;
  learningProgress = undefined;
  hideLearningDraft();
  learnName.value = '';
  learnCapture.hidden = true;
  learnStart.textContent = 'Start learning';
  learnStatus.textContent = 'Start learning, then send one message yourself in the active chat.';
}

async function restoreLearningDraft(): Promise<void> {
  if (learnStart.disabled) return;
  if (discoveryDraft) {
    if (draftMatchesActivePage(discoveryDraft)) {
      learnName.hidden = false;
      learnPropose.hidden = !discoveryDraft.trace;
      renderLearnCapabilities(discoveryDraft.capabilities);
      renderLearnProposal(discoveryDraft);
      renderLearnValidation(discoveryDraft);
    }
    return;
  }
  const pageUrl = activeTabUrl;
  const stored = await chrome.storage.local.get([DISCOVERY_DRAFT_KEY, LEGACY_LEARNING_DRAFT_KEY]);
  if (learnStart.disabled || discoveryDraft || activeTabUrl !== pageUrl) return;
  const draft = (stored[DISCOVERY_DRAFT_KEY] ?? stored[LEGACY_LEARNING_DRAFT_KEY]) as
    | BrowserProviderDiscoveryDraft
    | undefined;
  if (!draft || !draftMatchesActivePage(draft)) return;
  discoveryDraft = draft;
  learnName.value = draft.targetProviderId
    ? draft.targetProviderName ?? draft.profile.name
    : suggestedProviderName(draft.profile);
  learnName.hidden = false;
  learnCapture.hidden = true;
  learnProgress.hidden = true;
  learnPropose.hidden = !draft.trace;
  if (learnStart.textContent !== 'Stop learning')
    learnStatus.textContent =
      draft.readyToSave === true
        ? 'A saved learning draft is ready to review.'
        : 'This learning draft did not pass lifecycle validation. Capture a new active response.';
  renderLearnCapabilities(draft.capabilities);
  renderLearnProposal(draft);
  renderLearnValidation(draft);
}

async function refreshActiveProvider(retry = true): Promise<void> {
  const checkId = ++providerCheckId;
  provider.textContent = 'Checking this tab for a supported chat…';
  // Keep the last detection visible during rechecks, but disable queue edits until it completes.
  activeProviderChecking = true;
  if (mode === 'queue' && currentQueue) renderQueue(currentQueue);
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'ROVER_GET_ACTIVE_PROVIDER' })) as
      | {
          provider?: string;
          learningTabId?: number | null;
          tabId?: number;
          profile?: BrowserProviderProfile;
          url?: string;
          supportsNewConversation?: boolean;
          error?: string;
        }
      | undefined;
    if (checkId !== providerCheckId) return;
    activeProvider = response?.provider;
    activeProviderChecking = false;
    activeProviderProfile = response?.profile;
    activeTabUrl = response?.url;
    activeTabId = response?.tabId;
    if (response && 'learningTabId' in response && !learnStart.disabled) {
      if (response.learningTabId == null) {
        if (learnStart.textContent === 'Stop learning')
          learnStatus.textContent = 'Learning stopped. Start again when you are ready.';
        learnStart.textContent = 'Start learning';
        learnCapture.hidden = true;
        learnGuide.hidden = true;
      } else if (
        learnStart.textContent !== 'Stop learning' ||
        learnStatus.textContent === ACTIVE_LEARNING_STATUS ||
        learnStatus.textContent === OTHER_TAB_LEARNING_STATUS
      ) {
        learnStart.textContent = 'Stop learning';
        learnCapture.hidden = false;
        learnStatus.textContent =
          response.tabId === response.learningTabId
            ? ACTIVE_LEARNING_STATUS
            : OTHER_TAB_LEARNING_STATUS;
      }
      if (response.learningTabId != null) {
        if (response.tabId === response.learningTabId) renderLearningGuide();
        else learnGuide.hidden = true;
      }
    }
    if (discoveryDraft && !draftMatchesActivePage(discoveryDraft)) hideLearningDraft();
    if (response?.url && !response.error) await restoreLearningDraft();
    if (checkId !== providerCheckId) return;
    const providerName =
      activeProviderProfile?.name ??
      (activeProvider === 'claude'
        ? 'Claude'
        : activeProvider === 'chatgpt-com'
          ? 'ChatGPT'
          : activeProvider);
    provider.textContent =
      !response || response.error
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
    if (checkId !== providerCheckId) return;
    // Provider detection can race popup startup while the content script is loading.
    // Retry once after the content script has had time to initialize.
    if (retry) window.setTimeout(() => void refreshActiveProvider(false), 500);
    else {
      activeProvider = undefined;
      activeProviderChecking = false;
      provider.textContent = 'Could not check this tab. Try reopening Rover.';
      if (mode === 'queue') renderQueue(currentQueue);
    }
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

function renderCatalog(emptyLabel = 'No evaluations found'): void {
  const selectedTestCaseId = testCase.value;
  const selectedQueueEvaluationId = queueEvaluation.value;
  const visible = [...filterTestCases(items, search.value)].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
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
  if (!visible.length) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = emptyLabel;
    queueEvaluation.append(placeholder);
  }
  queueEvaluation.disabled = !visible.some((item) => item.eligible);
  if (visible.some((item) => item.id === selectedTestCaseId)) testCase.value = selectedTestCaseId;
  if (visible.some((item) => item.id === selectedQueueEvaluationId))
    queueEvaluation.value = selectedQueueEvaluationId;
  updateSelection();
}

function updateSelection(): void {
  queueAdd.disabled = !items.find((item) => item.id === queueEvaluation.value)?.eligible;
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
  items = [];
  renderCatalog('Loading evaluations…');
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ROVER_GET_CATALOG',
      origin: requestedOrigin
    });
    connect.disabled = false;
    if (!response?.ok) {
      renderCatalog('Could not load evaluations');
      setConnectionState('disconnected', 'Disconnected');
      status.textContent = `Connection error: ${response?.error ?? 'Could not connect.'}`;
      return;
    }
    setConnectionState('connected', 'Connected');
    origin.value = response.origin;
    items = response.testCases;
    renderCatalog();
    if (!current && mode === 'manual') {
      catalog.hidden = false;
      status.textContent = items.length ? 'Choose a test case' : 'No test cases found.';
    }
  } catch (error) {
    renderCatalog('Could not load evaluations');
    connect.disabled = false;
    setConnectionState('disconnected', 'Disconnected');
    status.textContent = `Connection error: ${error instanceof Error ? error.message : 'Could not connect.'}`;
  }
}

connect.addEventListener('click', () => void loadCatalog(origin.value));
search.addEventListener('input', () => renderCatalog());
testCase.addEventListener('change', updateSelection);
queueEvaluation.addEventListener('change', updateSelection);

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

function confidenceState(confidence: 'high' | 'medium' | 'low'): 'pass' | 'unknown' {
  return confidence === 'high' ? 'pass' : 'unknown';
}

function renderLearnCapabilities(
  capabilities: BrowserProviderDiscoveryDraft['capabilities']
): void {
  learnEvidenceSection.hidden = false;
  renderLearningGuide();
  learnProgress.hidden = true;
  renderIndicatorList(
    learnCapabilities,
    capabilities.map((capability) => ({
      label: capability.label,
      state: confidenceState(capability.confidence),
      detail: `${capability.detail} Confidence: ${capability.confidence}.`
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
      if (entry.label === 'New conversation') {
        if (entry.value === 'not configured' && previous !== 'not configured') {
          return {
            label: 'New conversation, omitted',
            state: 'unknown' as const,
            detail: 'No New Chat control will be saved in this profile.'
          };
        }
        if (
          draft.profile.newConversation?.confirmation === 'context-change' &&
          !draft.trace?.newConversationEvidence
        ) {
          return {
            label:
              previous === entry.value
                ? 'New conversation, kept but unconfirmed'
                : 'New conversation, changed but unconfirmed',
            state: 'unknown' as const,
            detail: `${entry.value}. The selector is configured, but Rover has not observed it start a new conversation.`
          };
        }
      }

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
  learnValidationSection.dataset.state = draft.readyToSave ? 'pass' : 'fail';
  const reasons = draft.validationReasons ?? [];
  learnSave.hidden = false;
  learnSaveWithoutNewChat.hidden = !canOmitUnconfirmedNewChat(draft);
  learnSave.disabled = draft.readyToSave !== true;
  learnSaveStatus.hidden = !learnSave.disabled;
  learnSaveStatus.textContent = learnSave.disabled
    ? `Cannot save yet: ${reasons.join(' ') || 'The provider must pass lifecycle validation.'}`
    : '';
  if (
    learnSave.disabled &&
    draft.profile.newConversation?.confirmation === 'context-change' &&
    !draft.trace?.newConversationEvidence
  ) {
    learnSaveStatus.textContent += ' Open a new conversation on the provider page to confirm it, or save without New Chat support. Evaluations without this support continue in the current conversation.';
  }
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

function renderLearningGuide(progress?: BrowserProviderDiscoveryProgress): void {
  if (progress) learningProgress = progress;
  const captured = Boolean(discoveryDraft && draftMatchesActivePage(discoveryDraft));
  const currentStep = captured
    ? 3
    : learningProgress?.submitDetected || learningProgress?.assistantDetected
    ? 2
    : learningProgress?.composerDetected
    ? 1
    : 0;
  const heading = document.createElement('div');
  heading.className = 'learning-guide-heading';
  const title = document.createElement('strong');
  title.textContent = 'Learning progress';
  const count = document.createElement('span');
  count.setAttribute('role', 'status');
  count.textContent = captured ? 'Response captured' : `Step ${currentStep + 1} of 3`;
  heading.append(title, count);
  const steps = document.createElement('ol');
  steps.className = 'learning-steps';
  const instructions = [
    [
      'Type one message in the chat',
      'Click the chat input and type a short message, such as “hi there”.'
    ],
    ['Send the message', 'Press Enter or click the chat’s Send button.'],
    ['Wait for the response', 'Keep the chat open while Rover captures the finished response.']
  ];
  instructions.forEach(([label, detail], index) => {
    const step = document.createElement('li');
    const state = index < currentStep ? 'complete' : index === currentStep ? 'current' : 'upcoming';
    step.dataset.state = state;
    if (state === 'current') step.setAttribute('aria-current', 'step');
    const marker = document.createElement('span');
    marker.className = 'learning-step-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = state === 'complete' ? '✓' : String(index + 1);
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = label;
    const status = document.createElement('span');
    status.className = 'learning-step-state';
    status.textContent = state === 'complete' ? 'Done' : state === 'current' ? 'Next' : 'Waiting';
    copy.append(name, status);
    if (state === 'current') {
      const instruction = document.createElement('p');
      instruction.textContent = detail;
      copy.append(instruction);
    }
    step.append(marker, copy);
    steps.append(step);
  });
  learnGuide.replaceChildren(heading, steps);
  learnGuide.hidden = false;
}

function renderLearnProgress(progress: BrowserProviderDiscoveryProgress): void {
  // The validated draft replaces live observations, including updates already in flight.
  if (discoveryDraft && draftMatchesActivePage(discoveryDraft)) return;
  renderLearningGuide(progress);
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

chrome.runtime.onMessage.addListener(
  (message: { type?: string }, sender?: chrome.runtime.MessageSender) => {
    if (message.type === 'ROVER_ACTIVE_PROVIDER_CHANGED') void refreshActiveProvider();
    if (message.type === 'ROVER_DEBUG_CHANGED' && mode === 'debug') void refreshDebug(false);
    if (message.type === 'ROVER_LEARN_PROGRESS') {
      const ignored = sender?.tab?.id !== undefined && sender.tab.id !== activeTabId;
      debugLog('learning progress received by panel', {
        senderTabId: sender?.tab?.id,
        activeTabId,
        ignored
      });
      if (ignored) return;
      const event = message as { progress?: BrowserProviderDiscoveryProgress };
      if (event.progress) renderLearnProgress(event.progress);
    }
    if (message.type === 'ROVER_LEARN_RESULT') {
      const event = message as { draft?: BrowserProviderDiscoveryDraft };
      if (!event.draft) return;
      const matchesPage = !activeTabUrl || draftMatchesActivePage(event.draft);
      debugLog('learning result received by panel', {
        senderTabId: sender?.tab?.id,
        activeTabId,
        matchesPage
      });
      learnProposeStatus.textContent = '';
      learnProposeStatus.hidden = true;
      discoveryDraft = {
        ...event.draft,
        targetProviderId:
          event.draft.targetProviderId ??
          (matchesPage ? selectedLearnTargetId ?? activeProvider : undefined),
        targetProviderName:
          event.draft.targetProviderName ??
          learnTargets.find(
            (target) =>
              target.id ===
              (event.draft?.targetProviderId ?? selectedLearnTargetId ?? activeProvider)
          )?.name ??
          (matchesPage ? activeProviderProfile?.name : undefined),
        sourceUrl: event.draft.sourceUrl ?? activeTabUrl
      };
      learnName.value = discoveryDraft.targetProviderId
        ? discoveryDraft.targetProviderName ?? discoveryDraft.profile.name
        : suggestedProviderName(discoveryDraft.profile);
      void chrome.storage.local.set({ [DISCOVERY_DRAFT_KEY]: discoveryDraft });
      learnStart.textContent = 'Stop learning';
      if (!matchesPage) {
        hideLearningDraft();
        return;
      }
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
      renderLearnCapabilities(discoveryDraft.capabilities);
      renderLearnProposal(discoveryDraft);
      renderLearnValidation(discoveryDraft);
    }
  }
);

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
