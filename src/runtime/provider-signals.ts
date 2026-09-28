import type { ResponseCandidate } from './candidate-selection';
import type {
  ProviderObservation,
  ProviderRawSignalName
} from './provider-state-engine';

export function observationFromCandidates(
  candidates: ResponseCandidate[],
  signals: Partial<Record<ProviderRawSignalName, boolean>>,
  error?: string | null,
  completionSignal?: string,
  observedAt = Date.now()
): ProviderObservation {
  const candidate = candidates.at(-1);
  return {
    observedAt,
    response: candidate
      ? {
          identity: candidate.key,
          text: candidate.text,
          belongsToRequest: true
        }
      : null,
    responseObserved: Boolean(candidate),
    signals,
    ...(error !== undefined ? { error } : {}),
    ...(completionSignal ? { completionSignal } : {})
  };
}
