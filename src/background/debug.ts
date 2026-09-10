import type { DebugElementCheck, DebugSnapshot, RoverState } from '../contracts';
import type { RoverQueueState } from '../queue/state';

export interface DebugSnapshotInput {
  checkedAt: string;
  origin: string;
  endpointConnected: boolean;
  endpointError?: string;
  tab?: { id?: number; url?: string };
  page?: { matched: boolean; provider?: DebugSnapshot['page']['provider']; elements: DebugElementCheck[]; error?: string };
  manual: RoverState | null;
  queue: RoverQueueState | null;
}

export function createDebugSnapshot(input: DebugSnapshotInput): DebugSnapshot {
  const activeItem = input.queue?.activeItemId
    ? input.queue.items.find((item) => item.queueItemId === input.queue?.activeItemId)
    : undefined;
  return {
    checkedAt: input.checkedAt,
    endpoint: { origin: input.origin, connected: input.endpointConnected, ...(input.endpointError ? { error: input.endpointError } : {}) },
    page: {
      tabId: input.tab?.id,
      url: input.tab?.url,
      matched: input.page?.matched ?? false,
      provider: input.page?.provider,
      error: input.page?.error
    },
    elements: input.page?.elements ?? [],
    rover: {
      manualStatus: input.manual?.status,
      queueStatus: input.queue?.status,
      activeQueueItem: activeItem?.name
    }
  };
}
