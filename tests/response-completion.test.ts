import { describe, expect, it, vi } from 'vitest';
import { IncompleteResponseError, waitForCompletedResponse } from '../src/runtime/response-tracker';
import type { ProviderObservation, ProviderRawSignalName } from '../src/runtime/provider-state-engine';

function observation(options: {
  text?: string;
  identity?: string;
  generating?: boolean;
  idle?: boolean;
  working?: boolean;
  responseObserved?: boolean;
  error?: string;
  signals?: Partial<Record<ProviderRawSignalName, boolean>>;
} = {}): ProviderObservation {
  const text = options.text ?? '';
  return {
    observedAt: Date.now(),
    response: text
      ? {
          identity: options.identity ?? 'test-response',
          text,
          belongsToRequest: true
        }
      : null,
    responseObserved: options.responseObserved ?? Boolean(text),
    signals: {
      ...(options.generating !== undefined ? { generation_active: options.generating } : {}),
      ...(options.idle !== undefined ? { idle_visible: options.idle } : {}),
      ...(options.working !== undefined ? { working_visible: options.working } : {}),
      ...options.signals
    },
    ...(options.error ? { error: options.error } : {})
  };
}

describe('waitForCompletedResponse', () => {
  it('starts a fresh stability window after generation resumes', async () => {
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      let completed = false;
      const pending = waitForCompletedResponse({
        readObservation: () => observation({
          text: 'unchanged answer',
          generating: Date.now() - startedAt >= 20 && Date.now() - startedAt < 40,
          idle: !(Date.now() - startedAt >= 20 && Date.now() - startedAt < 40)
        }),
        pollMs: 10,
        stabilityMs: 30,
        timeoutMs: 200
      }).then(() => { completed = true; });
      await vi.advanceTimersByTimeAsync(60);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(20);
      await pending;
      expect(completed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not count a tool-working interval as response stability', async () => {
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      let completed = false;
      const pending = waitForCompletedResponse({
        readObservation: () => observation({
          text: 'unchanged answer',
          generating: false,
          idle: true,
          working: Date.now() - startedAt >= 20 && Date.now() - startedAt < 40
        }),
        pollMs: 10,
        stabilityMs: 30,
        timeoutMs: 200
      }).then(() => { completed = true; });
      await vi.advanceTimersByTimeAsync(60);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(20);
      await pending;
      expect(completed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets stability when the selected assistant turn changes without text changing', async () => {
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      let completed = false;
      const pending = waitForCompletedResponse({
        readObservation: () => observation({
          text: 'same answer',
          identity: Date.now() - startedAt < 20 ? 'turn-a' : 'turn-b',
          generating: false,
          idle: true
        }),
        pollMs: 10,
        stabilityMs: 30,
        timeoutMs: 200
      }).then(() => { completed = true; });
      await vi.advanceTimersByTimeAsync(30);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(30);
      await pending;
      expect(completed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for stable text and an idle provider before returning', async () => {
    let reads = 0;
    const result = await waitForCompletedResponse({
      readObservation: () => {
        reads += 1;
        return observation({
          text: reads < 3 ? 'partial' : 'final',
          generating: reads < 4,
          idle: reads >= 4
        });
      },
      pollMs: 1,
      stabilityMs: 3,
      timeoutMs: 100
    });

    expect(result).toBe('final');
  });

  it('rejects when the provider reports an error', async () => {
    await expect(
      waitForCompletedResponse({
        readObservation: () => observation({
          text: 'partial',
          generating: true,
          idle: false,
          error: 'Something went wrong'
        }),
        pollMs: 1,
        stabilityMs: 3,
        timeoutMs: 100
      })
    ).rejects.toThrow('Something went wrong');
  });

  it('ignores an unchanged alert that was already present before submission', async () => {
    let reads = 0;
    const pending = waitForCompletedResponse({
      readObservation: () => {
        reads += 1;
        return observation({
          text: reads < 2 ? '' : 'final response',
          generating: reads < 3,
          idle: reads >= 3,
          error: 'Restore last session We recovered an unsaved view.'
        });
      },
      pollMs: 1,
      stabilityMs: 3,
      timeoutMs: 100,
      initialError: 'Restore last session We recovered an unsaved view.'
    });

    await expect(pending).resolves.toBe('final response');
  });

  it('still rejects when a new alert replaces the initial alert', async () => {
    let reads = 0;
    await expect(
      waitForCompletedResponse({
        readObservation: () => {
          reads += 1;
          return observation({
            text: '',
            generating: true,
            idle: false,
            error: reads === 1 ? 'Restore last session' : 'The provider failed'
          });
        },
        pollMs: 1,
        stabilityMs: 3,
        timeoutMs: 100,
        initialError: 'Restore last session'
      })
    ).rejects.toThrow('The provider failed');
  });

  it('times out without returning stale or partial content', async () => {
    vi.useFakeTimers();
    let reads = 0;
    const promise = waitForCompletedResponse({
      readObservation: () => {
        reads += 1;
        return observation({ text: 'partial', generating: true, idle: false });
      },
      pollMs: 10,
      stabilityMs: 20,
      timeoutMs: 30
    });
    const rejection = expect(promise).rejects.toThrow('Timed out');
    await vi.advanceTimersByTimeAsync(31);
    await rejection;
    expect(reads).toBeGreaterThanOrEqual(4);
    vi.useRealTimers();
  });

  it('rejects stable text when a required generation signal was never observed', async () => {
    await expect(
      waitForCompletedResponse({
        readObservation: () => observation({
          text: 'stable text',
          responseObserved: false,
          generating: false,
          idle: true
        }),
        pollMs: 1,
        stabilityMs: 3,
        timeoutMs: 100,
        requireGenerationSignal: true
      })
    ).rejects.toBeInstanceOf(IncompleteResponseError);
  });

  it('accepts stable text after a generation transition', async () => {
    let reads = 0;
    let completion: { state?: string; history?: unknown[] } | undefined;
    await expect(
      waitForCompletedResponse({
        readObservation: () => {
          reads += 1;
          return observation({
            text: 'final text',
            generating: reads === 1,
            idle: reads > 1
          });
        },
        pollMs: 1,
        stabilityMs: 3,
        timeoutMs: 100,
        requireGenerationSignal: true,
        onComplete: (details) => {
          completion = details;
        }
      })
    ).resolves.toBe('final text');
    expect(completion?.state).toBe('finished');
    expect(completion?.history).toEqual(expect.any(Array));
  });

  it('accepts a stable changed response when no generation control is available', async () => {
    let reads = 0;
    await expect(
      waitForCompletedResponse({
        readObservation: () => observation({
          text: 'final text',
          generating: false,
          idle: true,
          responseObserved: reads++ > 0
        }),
        pollMs: 1,
        stabilityMs: 3,
        timeoutMs: 100,
        requireGenerationSignal: true
      })
    ).resolves.toBe('final text');
  });

  it('honors named blocking evidence even when legacy booleans are idle', async () => {
    vi.useFakeTimers();
    try {
      const promise = waitForCompletedResponse({
        readObservation: () => observation({
          text: 'tool result',
          generating: false,
          working: false,
          idle: true,
          signals: { working_visible: true }
        }),
        pollMs: 10,
        stabilityMs: 20,
        timeoutMs: 50
      });
      const rejection = expect(promise).rejects.toThrow('Timed out');
      await vi.advanceTimersByTimeAsync(51);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
