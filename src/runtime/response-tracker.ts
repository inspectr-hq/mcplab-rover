import {
  ProviderStateEngine,
  type EvidenceRecord,
  type ProviderExecutionState,
  type ProviderObservation,
  type StateTransition,
  type ProviderStateEngineOptions
} from './provider-state-engine';

export interface ResponseCompletionDetails {
  generationObserved: boolean;
  responseObserved: boolean;
  completionSignal?: string;
  elapsedMs: number;
  stableForMs: number;
  state?: ProviderExecutionState;
  positiveEvidence?: EvidenceRecord[];
  blockingEvidence?: EvidenceRecord[];
  historicalEvidence?: EvidenceRecord[];
  history?: StateTransition[];
}

export class IncompleteResponseError extends Error {
  readonly code = 'incomplete';

  constructor(message = 'Response capture incomplete: generation was never observed') {
    super(message);
    this.name = 'IncompleteResponseError';
  }
}

export interface ResponseTrackerOptions {
  readObservation: () => ProviderObservation;
  initialError?: string | null;
  pollMs: number;
  stabilityMs: number;
  timeoutMs: number;
  minResponseAgeMs?: number;
  minimumStateDurationMs?: ProviderStateEngineOptions['minimumStateDurationMs'];
  requireGenerationSignal?: boolean;
  onComplete?: (details: ResponseCompletionDetails) => void;
  signal?: AbortSignal;
}

export function waitForCompletedResponse(options: ResponseTrackerOptions): Promise<string> {
  const startedAt = Date.now();
  const engineOptions: ProviderStateEngineOptions = {
    quietPeriodMs: options.stabilityMs,
    minResponseAgeMs: options.minResponseAgeMs ?? 0,
    timeoutMs: options.timeoutMs,
    minimumStateDurationMs: options.minimumStateDurationMs,
    requireGenerationSignal: options.requireGenerationSignal === true
  };
  const engine = new ProviderStateEngine(engineOptions, startedAt);
  engine.markSubmitted(startedAt);
  let timer: ReturnType<typeof setTimeout> | undefined;

  return new Promise((resolve, reject) => {
    const abort = () =>
      finish(() => reject(new DOMException('Response capture was cancelled', 'AbortError')));
    const finish = (callback: () => void) => {
      if (timer) clearTimeout(timer);
      callback();
    };
    const poll = () => {
      if (options.signal?.aborted) {
        abort();
        return;
      }
      const now = Date.now();
      const rawObservation = options.readObservation();
      const observation =
        rawObservation.error && rawObservation.error === options.initialError
          ? {
              ...rawObservation,
              error: null,
              signals: { ...rawObservation.signals, error_visible: false }
            }
          : rawObservation;
      const snapshot = engine.update(observation);
      if (snapshot.terminal) {
        if (snapshot.state === 'finished') {
          const text = observation.response?.text.trim() ?? '';
          options.onComplete?.({
            generationObserved: snapshot.generationObserved,
            responseObserved: snapshot.responseObserved,
            completionSignal: observation.completionSignal,
            elapsedMs: now - startedAt,
            stableForMs: Math.max(0, now - snapshot.stateSince),
            state: snapshot.state,
            positiveEvidence: snapshot.positiveEvidence,
            blockingEvidence: snapshot.blockingEvidence,
            historicalEvidence: snapshot.historicalEvidence,
            history: snapshot.history
          });
          finish(() => resolve(text));
          return;
        }
        if (snapshot.terminalReason === 'incomplete') {
          finish(() => reject(new IncompleteResponseError()));
          return;
        }
        finish(() => reject(new Error(snapshot.errorMessage ?? 'Response capture failed')));
        return;
      }
      timer = setTimeout(poll, options.pollMs);
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    poll();
  });
}
