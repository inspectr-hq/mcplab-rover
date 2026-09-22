import {
  ProviderStateEngine,
  type ProviderStateEngineOptions
} from './provider-state-engine';
import { observationFromResponseState } from './provider-signals';

export interface ResponseState {
  text: string;
  /** Identity of the selected assistant turn, stable across text growth. */
  turnKey?: string;
  isGenerating: boolean;
  isIdle: boolean;
  /** Independent positive evidence that provider-side work is continuing. */
  isWorking?: boolean;
  error?: string | null;
  /** True when the provider has observed an explicit generation transition. */
  generationObserved?: boolean;
  /** True when a response candidate changed after the request was submitted. */
  responseObserved?: boolean;
  completionSignal?: string;
  signals?: Partial<
    Record<
      import('./provider-state-engine').ProviderSignalName,
      boolean
    >
  >;
}

export interface ResponseCompletionDetails {
  generationObserved: boolean;
  responseObserved: boolean;
  completionSignal?: string;
  elapsedMs: number;
  stableForMs: number;
  state?: import('./provider-state-engine').ProviderExecutionState;
  positiveEvidence?: import('./provider-state-engine').EvidenceRecord[];
  blockingEvidence?: import('./provider-state-engine').EvidenceRecord[];
  history?: import('./provider-state-engine').StateTransition[];
}

export class IncompleteResponseError extends Error {
  readonly code = 'incomplete';

  constructor(message = 'Response capture incomplete: generation was never observed') {
    super(message);
    this.name = 'IncompleteResponseError';
  }
}

export interface ResponseTrackerOptions {
  read: () => ResponseState;
  initialError?: string | null;
  pollMs: number;
  stabilityMs: number;
  timeoutMs: number;
  minResponseAgeMs?: number;
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
      if (now - startedAt >= options.timeoutMs) {
        finish(() => reject(new Error('Timed out waiting for completed response')));
        return;
      }

      const rawState = options.read();
      const state =
        rawState.error && rawState.error === options.initialError
          ? {
              ...rawState,
              error: null,
              signals: { ...rawState.signals, error_visible: false }
            }
          : rawState;
      const snapshot = engine.update(observationFromResponseState(state, now));
      if (snapshot.terminal) {
        if (snapshot.state === 'finished') {
          const text = state.text.trim();
          options.onComplete?.({
            generationObserved: snapshot.generationObserved,
            responseObserved: snapshot.responseObserved,
            completionSignal: state.completionSignal,
            elapsedMs: now - startedAt,
            stableForMs: Math.max(0, now - snapshot.stateSince),
            state: snapshot.state,
            positiveEvidence: snapshot.positiveEvidence,
            blockingEvidence: snapshot.blockingEvidence,
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
