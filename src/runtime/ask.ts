import { selectResponseCandidate } from './candidate-selection';
import { waitForCompletedResponse } from './response-tracker';
import type { ChatProviderAdapter } from '../providers/types';

export async function ask(adapter: ChatProviderAdapter, prompt: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
  const baseline = adapter.getAssistantCandidates();
  await adapter.setComposerText(prompt);
  // Give framework-controlled composers time to process the synthetic input event
  // and enable their submit control before invoking the provider adapter.
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
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
