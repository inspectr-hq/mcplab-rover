export type RunOutcome = 'passed' | 'failed' | 'incomplete' | 'error';

export interface CheckCounts {
  passed: number;
  failed: number;
  not_evaluated: number;
  total: number;
}

export interface LiveTestCatalogItem {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  assertionCount: number;
  eligible: boolean;
  ineligibleReason?: string;
}

export interface LiveTestSessionView {
  id: string;
  testCaseId: string;
  testCaseName: string;
  prompt: string;
  client: string;
  status: 'ready' | 'completed' | 'cancelled';
  createdAt: string;
  expiresAt: string;
  evaluationGroupId?: string;
  completion?: LiveTestCompletion;
}

export interface LiveTestCompletion {
  runId: string;
  outcome: RunOutcome;
  checkCounts: CheckCounts;
  resultUrl: string;
}
