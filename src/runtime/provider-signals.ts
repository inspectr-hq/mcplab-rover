import type { ResponseCandidate } from './candidate-selection';
import type { ResponseState } from './response-tracker';
import type {
  ProviderObservation,
  ProviderRawSignalName,
  ProviderSignalEvaluator
} from './provider-state-engine';

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

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

export function responseStateFromObservation(observation: ProviderObservation): ResponseState {
  const generationActive = Boolean(
    observation.signals.generation_active || observation.signals.stop_visible
  );
  const working = Boolean(
    observation.signals.working_visible || observation.signals.assistant_busy
  );
  const idle = hasOwn(observation.signals, 'idle_visible')
    ? observation.signals.idle_visible === true
    : observation.signals.input_enabled === true;
  return {
    text: observation.response?.text ?? '',
    turnKey: observation.response?.identity,
    isGenerating: generationActive,
    isIdle: idle,
    isWorking: working,
    generationObserved: generationActive,
    responseObserved:
      observation.responseObserved ?? Boolean(observation.response?.belongsToRequest),
    completionSignal: observation.completionSignal,
    error: observation.error,
    signals: {
      ...observation.signals,
      response_present: Boolean(observation.response?.text.trim())
    }
  };
}

export function evaluatorState(
  evaluator: ProviderSignalEvaluator,
  candidates: ResponseCandidate[]
): ResponseState {
  return responseStateFromObservation(evaluator.evaluate(candidates, Date.now()));
}

export function observationFromResponseState(
  state: ResponseState,
  observedAt: number
): ProviderObservation {
  const text = state.text.trim();
  const response = text
    ? {
        identity: state.turnKey ?? 'legacy-response',
        text: state.text,
        belongsToRequest: state.responseObserved !== false || state.turnKey === undefined
      }
    : null;
  const signals = state.signals ?? {};
  return {
    observedAt,
    response,
    responseObserved: state.responseObserved === true,
    historicalGenerationObserved: state.generationObserved === true,
    signals: {
      generation_active: state.isGenerating,
      working_visible: state.isWorking,
      idle_visible: state.isIdle,
      ...signals
    },
    error: state.error,
    completionSignal: state.completionSignal
  };
}
