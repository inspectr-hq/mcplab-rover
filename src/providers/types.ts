import type { ProviderId } from '../contracts';
import type { DebugElementCheck } from '../contracts';
import type { ResponseCandidate } from '../runtime/candidate-selection';
import type { ResponseState } from '../runtime/response-tracker';

export interface ChatProviderAdapter {
  id: ProviderId;
  matchesPage(): boolean;
  canHandle(): boolean;
  findComposer(): HTMLElement | null;
  setComposerText(text: string): Promise<void>;
  findSubmitButton(): HTMLButtonElement | null;
  submit(): Promise<void>;
  stopGeneration?(): Promise<void>;
  startNewConversation?(): Promise<void>;
  getAssistantCandidates(): ResponseCandidate[];
  getResponseState(candidates: ResponseCandidate[]): ResponseState;
  getDebugChecks(): DebugElementCheck[];
}
