import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  getState: vi.fn()
}));

vi.mock('../src/background/store', async () => {
  const actual = await vi.importActual<typeof import('../src/background/store')>('../src/background/store');
  return { ...actual, getState: mocks.getState };
});

import { installMessageHandler } from '../src/background/messages';

describe('background message routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
      runtime: { onMessage: { addListener: mocks.addListener } }
    } as unknown as typeof chrome;
  });

  it('registers a runtime handler for state reads', async () => {
    const state = { status: 'ready' };
    mocks.getState.mockResolvedValue(state);
    installMessageHandler();
    const listener = mocks.addListener.mock.calls.at(-1)?.[0] as (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean;
    const sendResponse = vi.fn();

    expect(listener({ type: 'ROVER_GET_STATE' }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(state));
  });
});
