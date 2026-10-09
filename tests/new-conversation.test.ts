import { afterEach, expect, it, vi } from 'vitest';
import { startQueueConversation, waitForTabComplete } from '../src/background/queue-runner';
import { createQueue } from '../src/queue/state';
import { McplabClient } from '../src/mcplab/api-client';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('identifies a learned provider without New Chat support as a configuration error', async () => {
  vi.spyOn(McplabClient.prototype, 'listBrowserProviders').mockResolvedValue([
    { id: 'polo', name: 'Polo' } as never
  ]);
  const queue = { ...createQueue('http://localhost:8787', 'polo', true, 'now'), tabId: 7 };
  await expect(startQueueConversation(queue)).rejects.toMatchObject({
    code: 'new_conversation_unsupported',
    message:
      'Polo has no New Chat support. Choose Continue the same conversation or learn a New Chat action.'
  });
});

it('distinguishes an unavailable provider profile from unsupported New Chat', async () => {
  vi.spyOn(McplabClient.prototype, 'listBrowserProviders').mockResolvedValue([]);
  const queue = { ...createQueue('http://localhost:8787', 'polo', true, 'now'), tabId: 7 };
  await expect(startQueueConversation(queue)).rejects.toThrow(
    "Provider profile 'polo' is unavailable."
  );
});

function navigationPage(
  options: { legacyClick?: boolean; ready?: boolean; detected?: string } = {}
) {
  vi.useFakeTimers();
  const url = 'https://polo.example/new';
  vi.spyOn(McplabClient.prototype, 'listBrowserProviders').mockResolvedValue([
    {
      id: 'polo',
      name: 'Polo',
      newConversation: options.legacyClick
        ? { action: 'click', locator: { segments: ['a'] } }
        : { action: 'navigate', url }
    } as never
  ]);
  const order: string[] = [];
  const update = vi.fn(async () => {
    order.push('navigate');
    return { status: 'loading' };
  });
  const sendMessage = vi.fn(async (_tabId, message) => {
    order.push(message.type);
    if (message.type === 'ROVER_DETECT') return options.detected ?? 'polo';
    if (message.type === 'ROVER_NEW_CHAT_READY')
      return { ok: true, provider: options.detected ?? 'polo', ready: options.ready !== false };
    if (message.type === 'ROVER_NEW_CHAT') {
      if (options.legacyClick) return { ok: true, navigationUrl: url };
      throw new Error('The old content script was unloaded');
    }
  });
  vi.stubGlobal('chrome', {
    tabs: {
      update,
      sendMessage,
      get: vi.fn(async () => ({ status: 'complete', url })),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }
    },
    scripting: { executeScript: vi.fn() }
  });
  const queue = { ...createQueue('http://localhost:8787', 'polo', true, 'now'), tabId: 7 };
  return { queue, update, sendMessage, order, url };
}

it.each([false, true])(
  'verifies navigation from the background across reloads (legacy click: %s)',
  async (legacyClick) => {
    const page = navigationPage({ legacyClick });
    let finished = false;
    const result = startQueueConversation(page.queue).then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    await result;
    expect(page.update).toHaveBeenCalledWith(7, { url: page.url });
    const checks = page.order.filter((item) => item === 'ROVER_NEW_CHAT_READY');
    expect(checks.length).toBeGreaterThan(1);
    expect(page.order.indexOf('navigate')).toBeLessThan(page.order.indexOf('ROVER_NEW_CHAT_READY'));
    expect(page.order.filter((item) => item === 'ROVER_NEW_CHAT')).toHaveLength(
      legacyClick ? 1 : 0
    );
  }
);

it('fails navigation when a populated chat remains after loading', async () => {
  const page = navigationPage({ ready: false });
  const result = startQueueConversation(page.queue).then(
    () => 'resolved',
    (error: Error) => error.message
  );
  await vi.advanceTimersByTimeAsync(16_000);
  expect(await result).toContain('new conversation did not become ready');
});

it('requires the expected provider after navigation', async () => {
  const page = navigationPage({ detected: 'other' });
  const result = startQueueConversation(page.queue).then(
    () => 'resolved',
    (error: Error) => error.message
  );
  await vi.advanceTimersByTimeAsync(31_000);
  expect(await result).toContain("Browser provider 'polo' was not ready");
  expect(
    page.sendMessage.mock.calls.some(([, message]) => message.type === 'ROVER_NEW_CHAT_READY')
  ).toBe(false);
});

it('waits through loading and a replacement content script starting', async () => {
  const page = navigationPage();
  const chromeMock = chrome as unknown as {
    tabs: {
      get: ReturnType<typeof vi.fn>;
      sendMessage: ReturnType<typeof vi.fn>;
      onUpdated: {
        addListener: ReturnType<typeof vi.fn>;
        removeListener: ReturnType<typeof vi.fn>;
      };
    };
  };
  chromeMock.tabs.get
    .mockResolvedValueOnce({ status: 'complete', url: 'https://polo.example/old' })
    .mockResolvedValue({ status: 'loading' });
  const originalSend = page.sendMessage.getMockImplementation()!;
  let unavailable = 2;
  page.sendMessage.mockImplementation(async (tabId, message) => {
    if (message.type === 'ROVER_NEW_CHAT_READY' && unavailable-- > 0)
      throw new Error('Receiving end does not exist');
    return originalSend(tabId, message);
  });
  const result = startQueueConversation(page.queue);
  await vi.advanceTimersByTimeAsync(100);
  expect(page.order).toEqual(['navigate']);
  const complete = chromeMock.tabs.onUpdated.addListener.mock.calls[0][0];
  complete(7, { status: 'complete' });
  await vi.advanceTimersByTimeAsync(1000);
  await result;
  expect(chromeMock.tabs.onUpdated.removeListener).toHaveBeenCalledWith(complete);
  expect(page.update).toHaveBeenCalledTimes(1);
});

it('observes load completion that arrives while reading the tab status', async () => {
  vi.useFakeTimers();
  let listener: ((id: number, change: { status: string }) => void) | undefined;
  const removeListener = vi.fn();
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn(async () => {
        listener?.(7, { status: 'complete' });
        return { status: 'loading' };
      }),
      onUpdated: {
        addListener: (callback: typeof listener) => {
          listener = callback;
        },
        removeListener
      }
    }
  });
  const result = waitForTabComplete(7).then(
    () => 'resolved',
    (error: Error) => error.message
  );
  await vi.advanceTimersByTimeAsync(30_001);
  expect(await result).toBe('resolved');
  expect(removeListener).toHaveBeenCalledWith(listener);
});
