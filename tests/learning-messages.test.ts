import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExtensionMessage } from '../src/contracts';

let activeTabId: number;
let listener: (
  message: ExtensionMessage,
  sender: unknown,
  respond: (value: unknown) => void
) => unknown;
let stored: Record<string, unknown>;
const sendMessage = vi.fn();
const getTab = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  activeTabId = 11;
  stored = {};
  sendMessage.mockReset().mockResolvedValue({ ok: true });
  getTab.mockReset().mockImplementation(async (id) => ({ id }));
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: (callback: typeof listener) => {
          listener = callback;
        }
      }
    },
    tabs: { query: vi.fn(async () => [{ id: activeTabId }]), sendMessage, get: getTab },
    storage: {
      session: {
        get: vi.fn(async () => ({ ...stored })),
        set: vi.fn(async (values) => {
          Object.assign(stored, values);
        }),
        remove: vi.fn(async (key) => {
          delete stored[key];
        })
      }
    }
  });
  (await import('../src/background/messages')).installMessageHandler();
});
afterEach(() => vi.unstubAllGlobals());

function dispatch(message: ExtensionMessage) {
  return new Promise((resolve) => listener(message, {}, resolve));
}

it('captures and stops the original learning tab after switching tabs and restarting the background', async () => {
  expect(await dispatch({ type: 'ROVER_LEARN_START' })).toMatchObject({ ok: true });
  vi.resetModules();
  (await import('../src/background/messages')).installMessageHandler();
  activeTabId = 22;
  expect(await dispatch({ type: 'ROVER_LEARN_CAPTURE' })).toMatchObject({ ok: true });
  expect(await dispatch({ type: 'ROVER_LEARN_STOP' })).toMatchObject({ ok: true });
  expect(sendMessage.mock.calls.map(([id, message]) => [id, message.type])).toEqual([
    [11, 'ROVER_LEARN_START'],
    [11, 'ROVER_LEARN_CAPTURE'],
    [11, 'ROVER_LEARN_STOP']
  ]);
  expect(Object.values(stored)).not.toContain(11);
});

it('does not start another tab while a learning session is active', async () => {
  await dispatch({ type: 'ROVER_LEARN_START' });
  activeTabId = 22;
  expect(await dispatch({ type: 'ROVER_LEARN_START' })).toMatchObject({ ok: false });
  expect(sendMessage).toHaveBeenCalledTimes(1);
});

it('does not retain ownership when learning fails to start', async () => {
  sendMessage.mockResolvedValueOnce({ ok: false, error: 'Could not start learning.' });
  expect(await dispatch({ type: 'ROVER_LEARN_START' })).toMatchObject({ ok: false });
  expect(Object.values(stored)).not.toContain(11);
});

it('clears a learning session whose tab has closed without stopping the new active tab', async () => {
  await dispatch({ type: 'ROVER_LEARN_START' });
  activeTabId = 22;
  getTab.mockRejectedValueOnce(new Error('Tab closed'));
  expect(await dispatch({ type: 'ROVER_LEARN_STOP' })).toMatchObject({ ok: true });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(Object.values(stored)).not.toContain(11);
});

it('serializes simultaneous starts so only one tab owns learning', async () => {
  const results = await Promise.all([
    dispatch({ type: 'ROVER_LEARN_START' }),
    dispatch({ type: 'ROVER_LEARN_START' })
  ]);
  expect(results).toMatchObject([{ ok: true }, { ok: false }]);
  expect(sendMessage).toHaveBeenCalledTimes(1);
});

it('retains the original tab when Stop fails so it can be retried', async () => {
  await dispatch({ type: 'ROVER_LEARN_START' });
  activeTabId = 22;
  sendMessage.mockRejectedValueOnce(new Error('Temporary delivery failure'));
  expect(await dispatch({ type: 'ROVER_LEARN_STOP' })).toMatchObject({ ok: false });
  expect(await dispatch({ type: 'ROVER_LEARN_STOP' })).toMatchObject({ ok: true });
  expect(sendMessage.mock.calls.map(([id]) => id)).toEqual([11, 11, 11]);
});

it('clears ownership when the original content script has disappeared after navigation', async () => {
  await dispatch({ type: 'ROVER_LEARN_START' });
  activeTabId = 22;
  sendMessage.mockRejectedValueOnce(
    new Error('Could not establish connection. Receiving end does not exist.')
  );
  expect(await dispatch({ type: 'ROVER_LEARN_STOP' })).toMatchObject({ ok: true });
  expect(Object.values(stored)).not.toContain(11);
  expect(sendMessage.mock.calls.map(([id]) => id)).toEqual([11, 11]);
});
