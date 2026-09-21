import { describe, expect, it, vi } from 'vitest';
import { IncompleteResponseError, waitForCompletedResponse } from '../src/runtime/response-tracker';

describe('waitForCompletedResponse', () => {
  it('starts a fresh stability window after generation resumes', async () => {
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      let completed = false;
      const pending = waitForCompletedResponse({
        read: () => ({
          text: 'unchanged answer',
          isGenerating: Date.now() - startedAt >= 20 && Date.now() - startedAt < 40,
          isIdle: !(Date.now() - startedAt >= 20 && Date.now() - startedAt < 40)
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
        read: () => ({
          text: 'unchanged answer',
          isGenerating: false,
          isIdle: true,
          isWorking: Date.now() - startedAt >= 20 && Date.now() - startedAt < 40
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
        read: () => ({
          text: 'same answer',
          turnKey: Date.now() - startedAt < 20 ? 'turn-a' : 'turn-b',
          isGenerating: false,
          isIdle: true
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
      read: () => {
        reads += 1;
        return {
          text: reads < 3 ? 'partial' : 'final',
          isGenerating: reads < 4,
          isIdle: reads >= 4
        };
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
        read: () => ({
          text: 'partial',
          isGenerating: true,
          isIdle: false,
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
      read: () => {
        reads += 1;
        return {
          text: reads < 2 ? '' : 'final response',
          isGenerating: reads < 3,
          isIdle: reads >= 3,
          error: 'Restore last session We recovered an unsaved view.'
        };
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
        read: () => {
          reads += 1;
          return {
            text: '',
            isGenerating: true,
            isIdle: false,
            error: reads === 1 ? 'Restore last session' : 'The provider failed'
          };
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
    const promise = waitForCompletedResponse({
      read: () => ({ text: 'partial', isGenerating: true, isIdle: false }),
      pollMs: 10,
      stabilityMs: 20,
      timeoutMs: 30
    });
    const rejection = expect(promise).rejects.toThrow('Timed out');
    await vi.advanceTimersByTimeAsync(31);
    await rejection;
    vi.useRealTimers();
  });

  it('rejects stable text when a required generation signal was never observed', async () => {
    await expect(
      waitForCompletedResponse({
        read: () => ({ text: 'stable text', isGenerating: false, isIdle: true }),
        pollMs: 1,
        stabilityMs: 3,
        timeoutMs: 100,
        requireGenerationSignal: true
      })
    ).rejects.toBeInstanceOf(IncompleteResponseError);
  });

  it('accepts stable text after a generation transition', async () => {
    let reads = 0;
    await expect(
      waitForCompletedResponse({
        read: () => {
          reads += 1;
          return {
            text: 'final text',
            isGenerating: reads === 1,
            isIdle: reads > 1
          };
        },
        pollMs: 1,
        stabilityMs: 3,
        timeoutMs: 100,
        requireGenerationSignal: true
      })
    ).resolves.toBe('final text');
  });

  it('accepts a stable changed response when no generation control is available', async () => {
    let reads = 0;
    await expect(
      waitForCompletedResponse({
        read: () => ({
          text: 'final text',
          isGenerating: false,
          isIdle: true,
          responseObserved: reads++ > 0
        }),
        pollMs: 1,
        stabilityMs: 3,
        timeoutMs: 100,
        requireGenerationSignal: true
      })
    ).resolves.toBe('final text');
  });
});
