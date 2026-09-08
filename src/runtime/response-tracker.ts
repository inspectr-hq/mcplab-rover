export interface ResponseState {
  text: string;
  isGenerating: boolean;
  isIdle: boolean;
  error?: string | null;
}

export interface ResponseTrackerOptions {
  read: () => ResponseState;
  pollMs: number;
  stabilityMs: number;
  timeoutMs: number;
  minResponseAgeMs?: number;
}

export function waitForCompletedResponse(options: ResponseTrackerOptions): Promise<string> {
  const startedAt = Date.now();
  let lastText = '';
  let stableSince: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return new Promise((resolve, reject) => {
    const finish = (callback: () => void) => {
      if (timer) clearTimeout(timer);
      callback();
    };
    const poll = () => {
      const now = Date.now();
      if (now - startedAt >= options.timeoutMs) {
        finish(() => reject(new Error('Timed out waiting for completed response')));
        return;
      }

      const state = options.read();
      if (state.error) {
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
        finish(() => resolve(text));
        return;
      }
      timer = setTimeout(poll, options.pollMs);
    };
    poll();
  });
}
