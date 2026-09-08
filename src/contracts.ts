import type { CheckCounts, RunOutcome } from './mcplab/types';

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
  | { type: 'ROVER_GET_CATALOG'; origin?: string }
  | { type: 'ROVER_GET_STATE' }
  | { type: 'ROVER_PREPARE'; testCaseId: string; origin?: string }
  | { type: 'ROVER_EXECUTE' }
  | { type: 'ROVER_COMPLETE_MANUAL'; text: string }
  | { type: 'ROVER_CANCEL' }
  | { type: 'ROVER_DETECT' }
  | { type: 'ROVER_ASK'; requestId: string; sessionId: string; prompt: string }
  | {
      type: 'ROVER_RESULT';
      requestId: string;
      sessionId: string;
      result: { ok: true; text: string } | { ok: false; error: string };
    };
