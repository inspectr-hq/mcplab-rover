export type RunOutcome = 'passed' | 'failed' | 'incomplete' | 'error';

export type BrowserProviderConfidence = 'high' | 'medium' | 'low';

export interface ShadowLocator {
  segments: string[];
}

export interface BrowserProviderProfile {
  schemaVersion: 1;
  id: string;
  name: string;
  match: { origins: string[] };
  composer: { locator: ShadowLocator; inputMode: 'input' | 'textarea' | 'contenteditable' };
  submit: { action: 'click' | 'enter'; locator?: ShadowLocator };
  assistantMessages: { locator: ShadowLocator; textLocator?: ShadowLocator };
  completion: { generatingLocator?: ShadowLocator; idleLocator?: ShadowLocator; stabilityMs: number };
  newConversation?: { action: 'click' | 'navigate'; locator?: ShadowLocator; url?: string };
  learned: {
    sourceOrigin: string;
    createdAt: string;
    updatedAt: string;
    confidence: Record<string, BrowserProviderConfidence>;
  };
}

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
  evaluationRunId?: string;
  completion?: LiveTestCompletion;
}

export interface LiveTestCompletion {
  runId: string;
  outcome: RunOutcome;
  checkCounts: CheckCounts;
  resultUrl: string;
}
