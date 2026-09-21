import type { CheckCounts, RunOutcome } from './mcplab/types';

export type ProviderId = string;
export interface BrowserProviderDiscoveryDraft {
  profile: import('./mcplab/types').BrowserProviderProfile;
  targetProviderId?: string;
  targetProviderName?: string;
  sourceUrl?: string;
  capturedProfile?: import('./mcplab/types').BrowserProviderProfile;
  readyToSave?: boolean;
  validationReasons?: string[];
  proposalDiagnostics?: { rationale: string[]; warnings: string[] };
  capabilities: Array<{
    id: string;
    label: string;
    confidence: 'high' | 'medium' | 'low';
    detail: string;
  }>;
  trace?: BrowserProviderDiscoveryTrace;
}
export interface BrowserProviderDiscoveryTraceEvent {
  phase: 'baseline' | 'submitted' | 'generating' | 'working' | 'candidate' | 'final';
  at: string;
  candidateCount: number;
  changedCandidateCount: number;
  visibleControlCount: number;
  disabledControlCount: number;
  workingActive?: boolean;
  selectedCandidate?: { tagName: string; testId?: string; textLength: number };
  textHash?: string;
  selectedElements?: Partial<
    Record<
      'composer' | 'submit' | 'assistant' | 'generating' | 'working' | 'idle',
      {
        locator: import('./mcplab/types').ShadowLocator;
        selectors: string[];
        selectorEvaluations?: Record<string, { matchCount: number; nonAssistantCount: number }>;
        visible: boolean;
        textLength: number;
        changedFromBaseline?: boolean;
        changedAfterSubmission?: boolean;
        absentAtSubmission?: boolean;
        candidateScore?: number;
        attributes?: {
          role?: string;
          ariaLabel?: string;
          testId?: string;
          dataTest?: string;
          authorRole?: string;
        };
      }
    >
  >;
  snapshot?: Array<{
    selector: string;
    tagName: string;
    role?: string;
    ariaLabel?: string;
    testId?: string;
    visible: boolean;
    disabled: boolean;
    textLength: number;
  }>;
}
export interface BrowserProviderDiscoveryTrace {
  evidenceVersion?: 1;
  newConversationEvidence?: {
    controlLocator: import('./mcplab/types').ShadowLocator;
    controlSelectors: string[];
    signal: 'url-changed' | 'assistant-count-reduced';
    beforeAssistantCount: number;
    afterAssistantCount: number;
  };
  observedGeneration: boolean;
  selectorValidation: {
    composer: { valid: boolean; matchCount: number; visible: boolean };
    submit: { valid: boolean; matchCount: number; visible: boolean };
    assistant: { valid: boolean; matchCount: number; visible: boolean };
  };
  events: BrowserProviderDiscoveryTraceEvent[];
}
export interface BrowserProviderDiscoveryProgress {
  composerDetected: boolean;
  submitDetected: boolean;
  assistantDetected: boolean;
  assistantPreview?: string;
  generatingObserved: boolean;
  idleObserved: boolean;
}
export type RoverStage =
  'prompt_sent' | 'waiting_for_response' | 'response_captured' | 'evaluating' | 'persisted';
export type RoverStatus = 'ready' | 'running' | 'manual' | 'evaluating' | 'completed' | 'error';

export interface RoverState {
  requestId: string;
  sessionId: string;
  testCaseId: string;
  testCaseName: string;
  prompt: string;
  origin: string;
  status: RoverStatus;
  tabId?: number;
  provider?: ProviderId;
  text?: string;
  error?: string;
  runId?: string;
  resultUrl?: string;
  outcome?: RunOutcome;
  checkCounts?: CheckCounts;
  startedAt: string;
  completedAt?: string;
}

export interface DebugElementCheck {
  id: string;
  label: string;
  present: boolean;
  detail: string;
  selector?: string;
}

export interface DebugSnapshot {
  checkedAt: string;
  endpoint: { origin: string; connected: boolean; checked: boolean; error?: string };
  page: {
    tabId?: number;
    url?: string;
    matched: boolean;
    provider?: ProviderId;
    profile?: { name: string; source: string; revision: string; capabilities: string[] };
    detection?: { attempts: number; checkedAt: string; provider?: ProviderId; error?: string };
    error?: string;
  };
  elements: DebugElementCheck[];
  rover: {
    manualStatus?: RoverStatus;
    queueStatus?: string;
    activeQueueItem?: string;
    negotiatedCapabilities?: string[];
    leaseId?: string;
    leaseState?: string;
    leaseExpiresAt?: string;
    lastLeaseRenewalAt?: string;
    boundTabId?: number;
    lastAssignmentDecision?: { decision: string; reason?: string; at: string };
  };
}

export interface WaitingEvaluation {
  jobId: string;
  evaluationName?: string;
  provider: ProviderId;
  position: number;
}

export type ExtensionMessage =
  | { type: 'ROVER_TOGGLE_PANEL' }
  | { type: 'ROVER_SHOW_PANEL' }
  | { type: 'ROVER_GET_CATALOG'; origin?: string }
  | { type: 'ROVER_GET_DEBUG'; origin?: string; checkEndpoint?: boolean }
  | { type: 'ROVER_DEBUG_SUBSCRIBE'; enabled: boolean }
  | { type: 'ROVER_DEBUG_CHANGED' }
  | { type: 'ROVER_PAGE_FOCUSED' }
  | { type: 'ROVER_GET_STATE' }
  | { type: 'ROVER_GET_ACTIVE_PROVIDER' }
  | { type: 'ROVER_START_NEW_CONVERSATION' }
  | { type: 'ROVER_QUEUE_GET' }
  | { type: 'ROVER_QUEUE_WAITING' }
  | { type: 'ROVER_QUEUE_CLEAR' }
  | { type: 'ROVER_QUEUE_CREATE'; origin?: string; newConversationBetweenItems: boolean }
  | {
      type: 'ROVER_QUEUE_ADD';
      item: { id: string; name: string; prompt: string; assertionCount: number };
    }
  | { type: 'ROVER_QUEUE_SET_NEW_CHAT'; enabled: boolean }
  | { type: 'ROVER_QUEUE_REMOVE'; queueItemId: string }
  | { type: 'ROVER_QUEUE_MOVE'; queueItemId: string; direction: 'up' | 'down' }
  | { type: 'ROVER_QUEUE_START' }
  | { type: 'ROVER_QUEUE_STOP' }
  | { type: 'ROVER_QUEUE_RETRY' }
  | { type: 'ROVER_QUEUE_SKIP' }
  | { type: 'ROVER_NEW_CHAT'; requestId: string; queueId: string }
  | { type: 'ROVER_CANCEL_ASK'; requestId: string }
  | { type: 'ROVER_PREPARE'; testCaseId: string; origin?: string }
  | { type: 'ROVER_EXECUTE' }
  | { type: 'ROVER_COMPLETE_MANUAL'; text: string }
  | { type: 'ROVER_CANCEL' }
  | { type: 'ROVER_DETECT' }
  | { type: 'ROVER_DEBUG' }
  | { type: 'ROVER_GET_LEARN_TARGETS' }
  | { type: 'ROVER_LEARN_START'; targetProviderId?: string }
  | { type: 'ROVER_LEARN_STOP' }
  | { type: 'ROVER_LEARN_CAPTURE' }
  | {
      type: 'ROVER_LEARN_SAVE';
      profile: import('./mcplab/types').BrowserProviderProfile;
      agent?: { id: string; name: string; url: string };
      origin?: string;
      trace?: BrowserProviderDiscoveryTrace;
      proposalDiagnostics?: { rationale: string[]; warnings: string[] };
    }
  | {
      type: 'ROVER_LEARN_PROPOSE';
      profile: import('./mcplab/types').BrowserProviderProfile;
      trace?: BrowserProviderDiscoveryTrace;
      origin?: string;
      agentName?: string;
    }
  | {
      type: 'ROVER_LEARN_VALIDATE';
      profile: import('./mcplab/types').BrowserProviderProfile;
      trace?: BrowserProviderDiscoveryTrace;
    }
  | { type: 'ROVER_LEARN_RESULT'; draft: BrowserProviderDiscoveryDraft }
  | { type: 'ROVER_LEARN_PROGRESS'; progress: BrowserProviderDiscoveryProgress }
  | {
      type: 'ROVER_ASK';
      requestId: string;
      sessionId: string;
      prompt: string;
      queueId?: string;
      queueItemId?: string;
      leaseId?: string;
    }
  | {
      type: 'ROVER_RESULT';
      requestId: string;
      sessionId: string;
      queueId?: string;
      queueItemId?: string;
      leaseId?: string;
      result: { ok: true; text: string } | { ok: false; error: string; code?: string };
    };
