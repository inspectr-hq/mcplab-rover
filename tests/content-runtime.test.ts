import { describe, expect, it, vi } from 'vitest';
import { createSafeRuntimeMessageSender } from '../src/content-runtime';

describe('safe content runtime messaging', () => {
  it('turns synchronous context invalidation into a quiet no-op', async () => {
    const sendMessage = vi.fn(() => {
      throw new Error('Extension context invalidated.');
    });
    const send = createSafeRuntimeMessageSender(sendMessage);

    await expect(send({ type: 'ROVER_PAGE_FOCUSED' })).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('turns rejected context invalidation into a quiet no-op and stops later sends', async () => {
    const sendMessage = vi.fn().mockRejectedValueOnce(new Error('Extension context invalidated.'));
    const send = createSafeRuntimeMessageSender(sendMessage);

    await expect(send({ type: 'ROVER_DEBUG_CHANGED' })).resolves.toBeUndefined();
    await expect(send({ type: 'ROVER_PAGE_FOCUSED' })).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('preserves non-invalidation failures', async () => {
    const failure = new Error('Receiving end does not exist.');
    const sendMessage = vi.fn().mockRejectedValue(failure);
    const send = createSafeRuntimeMessageSender(sendMessage);

    await expect(send({ type: 'ROVER_PAGE_FOCUSED' })).rejects.toBe(failure);
  });
});
