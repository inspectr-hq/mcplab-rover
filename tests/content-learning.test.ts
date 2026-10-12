// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

const discovery = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../src/providers/provider-discovery', () => ({ startProviderDiscovery: discovery.start }));

afterEach(() => {
  delete (globalThis as { __mcplabRoverInstalled?: boolean }).__mcplabRoverInstalled;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('safely delivers learning progress and tolerates extension reloads', async () => {
  vi.resetModules();
  let listener!: (message: unknown, sender: unknown, respond: unknown) => void;
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((callback) => {
          listener = callback;
        })
      }
    },
    storage: { local: { get: vi.fn().mockResolvedValue({}) }, onChanged: { addListener: vi.fn() } }
  });
  discovery.start.mockReturnValue({ stop: vi.fn(), capture: vi.fn() });
  await import('../src/content');
  listener({ type: 'ROVER_LEARN_START' }, {}, vi.fn());
  const report = discovery.start.mock.calls.at(-1)![1];
  const progress = {
    composerDetected: true,
    submitDetected: true,
    assistantDetected: false,
    generatingObserved: false,
    idleObserved: false
  };
  report(progress);
  await Promise.resolve();
  expect(sendMessage).toHaveBeenCalledWith({ type: 'ROVER_LEARN_PROGRESS', progress });
  sendMessage.mockClear();
  sendMessage.mockImplementation(() => {
    throw new Error('Extension context invalidated.');
  });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(() => report(progress)).not.toThrow();
  await Promise.resolve();
  report(progress);
  await Promise.resolve();
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
});
