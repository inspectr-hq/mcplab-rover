import { afterEach, expect, it, vi } from 'vitest';
import { startQueueConversation } from '../src/background/queue-runner';
import { createQueue } from '../src/queue/state';
import { McplabClient } from '../src/mcplab/api-client';

afterEach(() => vi.restoreAllMocks());

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
