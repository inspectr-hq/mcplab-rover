import { describe, expect, it } from 'vitest';
import { waitForCompletedResponse } from '../src/runtime/response-tracker';

describe('response tracker cancellation', () => {
  it('rejects promptly when its abort signal is cancelled', async () => {
    const controller = new AbortController();
    const pending = waitForCompletedResponse({
      pollMs: 1000,
      stabilityMs: 1000,
      timeoutMs: 10_000,
      signal: controller.signal,
      read: () => ({ text: '', isGenerating: true, isIdle: false })
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
