export interface ResponseState {
  text: string;
  isGenerating: boolean;
  isIdle: boolean;
  error?: string | null;
  /** True when the provider has observed an explicit generation transition. */
  generationObserved?: boolean;
  completionSignal?: string;
}

export interface ResponseCompletionDetails {
  generationObserved: boolean;
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
  let stableSince: number | null = null;
  let generationObserved = false;
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
      if (state.error && state.error !== options.initialError) {
        finish(() => reject(new Error(state.error!)));
        return;
      }

      const text = state.text.trim();
      if (text !== lastText) {
        lastText = text;
        stableSince = text ? now : null;
      }
      if (
        text &&
        stableSince !== null &&
        now - stableSince >= options.stabilityMs &&
        now - startedAt >= (options.minResponseAgeMs ?? 0) &&
        !state.isGenerating &&
        state.isIdle
      ) {
        if (options.requireGenerationSignal && !generationObserved) {
          finish(() => reject(new IncompleteResponseError()));
          return;
        }
        options.onComplete?.({
          generationObserved,
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
