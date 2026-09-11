import { selectResponseCandidate } from './candidate-selection';
import { waitForCompletedResponse } from './response-tracker';
import type { ChatProviderAdapter } from '../providers/types';

export async function ask(adapter: ChatProviderAdapter, prompt: string, signal?: AbortSignal): Promise<string> {
  const baseline = adapter.getAssistantCandidates();
  await adapter.setComposerText(prompt);
  await adapter.submit();
  return waitForCompletedResponse({
    pollMs: 100,
    stabilityMs: adapter.id === 'claude' ? 1500 : 2500,
    minResponseAgeMs: 500,
    timeoutMs: 120_000,
    signal,
    read: () => {
      const current = adapter.getAssistantCandidates();
      const selected = selectResponseCandidate(baseline, current);
      return adapter.getResponseState(selected ? [selected] : []);
    }
  });
}
