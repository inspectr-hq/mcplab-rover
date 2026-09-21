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
}

export interface ResponseCompletionDetails {
  generationObserved: boolean;
  responseObserved: boolean;
  completionSignal?: string;
  elapsedMs: number;
  stableForMs: number;
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
  let lastText = '';
  let lastTurnKey: string | undefined;
  let stableSince: number | null = null;
  let generationObserved = false;
  let responseObserved = false;
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

      const state = options.read();
      generationObserved ||= state.generationObserved ?? state.isGenerating;
      responseObserved ||= state.responseObserved === true;
      if (state.error && state.error !== options.initialError) {
        finish(() => reject(new Error(state.error!)));
        return;
      }

      const text = state.text.trim();
      const turnChanged = state.turnKey !== lastTurnKey;
      lastTurnKey = state.turnKey;
      if (text !== lastText || turnChanged) {
        lastText = text;
        stableSince = text ? now : null;
      }
      if (state.isGenerating || state.isWorking || !state.isIdle) stableSince = null;
      else if (text && stableSince === null) stableSince = now;
      if (
        text &&
        stableSince !== null &&
        now - stableSince >= options.stabilityMs &&
        now - startedAt >= (options.minResponseAgeMs ?? 0) &&
        !state.isGenerating &&
        !state.isWorking &&
        state.isIdle
      ) {
        if (options.requireGenerationSignal && !generationObserved && !responseObserved) {
          finish(() => reject(new IncompleteResponseError()));
          return;
        }
        options.onComplete?.({
          generationObserved,
          responseObserved,
          completionSignal: state.completionSignal,
          elapsedMs: now - startedAt,
          stableForMs: now - stableSince
        });
        finish(() => resolve(text));
        return;
      }
      timer = setTimeout(poll, options.pollMs);
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    poll();
  });
}
