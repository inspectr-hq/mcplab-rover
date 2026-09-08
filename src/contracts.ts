export const SMOKE_PROMPT =
  'Briefly describe the tasks you can help with and give one concrete example.';

export type ProviderId = 'claude' | 'trendminer';

export interface RunState {
  requestId: string;
  tabId: number;
  status: 'running' | 'completed' | 'error';
  provider?: ProviderId;
  text?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export type ExtensionMessage =
  | { type: 'ROVER_START'; tabId?: number; prompt: string }
  | { type: 'ROVER_GET_STATE' }
  | { type: 'ROVER_ASK'; requestId: string; prompt: string }
  | { type: 'ROVER_RESULT'; requestId: string; result: { ok: true; text: string } | { ok: false; error: string } };
