import type { CheckCounts, RunOutcome } from './mcplab/types';
import type { RoverQueueState } from './queue/state';

export type ProviderId = 'claude' | 'trendminer';
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

export type ExtensionMessage =
  | { type: 'ROVER_TOGGLE_PANEL' }
  | { type: 'ROVER_SHOW_PANEL' }
  | { type: 'ROVER_GET_CATALOG'; origin?: string }
  | { type: 'ROVER_GET_STATE' }
  | { type: 'ROVER_QUEUE_GET' }
  | { type: 'ROVER_QUEUE_CREATE'; origin?: string; newConversationBetweenItems: boolean }
  | { type: 'ROVER_QUEUE_ADD'; item: { id: string; name: string; prompt: string; assertionCount: number } }
  | { type: 'ROVER_QUEUE_SET_NEW_CHAT'; enabled: boolean }
  | { type: 'ROVER_QUEUE_REMOVE'; queueItemId: string }
  | { type: 'ROVER_QUEUE_MOVE'; queueItemId: string; direction: 'up' | 'down' }
  | { type: 'ROVER_QUEUE_START' }
  | { type: 'ROVER_QUEUE_STOP' }
  | { type: 'ROVER_QUEUE_RETRY' }
  | { type: 'ROVER_QUEUE_SKIP' }
  | { type: 'ROVER_NEW_CHAT'; requestId: string; queueId: string }
  | { type: 'ROVER_PREPARE'; testCaseId: string; origin?: string }
  | { type: 'ROVER_EXECUTE' }
  | { type: 'ROVER_COMPLETE_MANUAL'; text: string }
  | { type: 'ROVER_CANCEL' }
  | { type: 'ROVER_DETECT' }
  | { type: 'ROVER_ASK'; requestId: string; sessionId: string; prompt: string; queueId?: string; queueItemId?: string }
  | {
      type: 'ROVER_RESULT';
      requestId: string;
      sessionId: string;
      queueId?: string;
      queueItemId?: string;
      result: { ok: true; text: string } | { ok: false; error: string };
    };
