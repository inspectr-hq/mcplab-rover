import { afterEach, expect, it, vi } from 'vitest';
import { detectProvider, getDetectionDiagnostics } from '../src/background/browser';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('returns an unsupported tab immediately for UI checks instead of waiting through retries', async () => {
  vi.useFakeTimers();
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { tabs: { sendMessage } });
  await expect(detectProvider(11, false)).resolves.toBeUndefined();
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(getDetectionDiagnostics(11)?.attempts).toBe(1);
});

it('still retries detection for callers waiting for a provider to become ready', async () => {
  vi.useFakeTimers();
  const sendMessage = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue('claude');
  vi.stubGlobal('chrome', { tabs: { sendMessage } });
  const detection = detectProvider(22);
  await vi.advanceTimersByTimeAsync(300);
  await expect(detection).resolves.toBe('claude');
  expect(sendMessage).toHaveBeenCalledTimes(2);
});
