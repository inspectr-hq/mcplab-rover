import { describe, expect, it, vi } from 'vitest';
import { waitForCompletedResponse } from '../src/runtime/response-tracker';

describe('waitForCompletedResponse', () => {
  it('waits for stable text and an idle provider before returning', async () => {
    let reads = 0;
    const result = await waitForCompletedResponse({
      read: () => {
        reads += 1;
        return { text: reads < 3 ? 'partial' : 'final', isGenerating: reads < 4, isIdle: reads >= 4 };
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
        read: () => ({ text: 'partial', isGenerating: true, isIdle: false, error: 'Something went wrong' }),
        pollMs: 1,
        stabilityMs: 3,
        timeoutMs: 100
      })
    ).rejects.toThrow('Something went wrong');
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
});
