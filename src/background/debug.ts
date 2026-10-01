import type { DebugElementCheck, DebugSnapshot, RoverState } from '../contracts';
import type { RoverQueueState } from '../queue/state';

export interface DebugSnapshotInput {
  checkedAt: string;
  origin: string;
  endpointConnected: boolean;
  endpointChecked?: boolean;
  endpointError?: string;
  tab?: { id?: number; url?: string };
  page?: {
    matched: boolean;
    provider?: DebugSnapshot['page']['provider'];
    profile?: DebugSnapshot['page']['profile'];
    detection?: DebugSnapshot['page']['detection'];
    elements: DebugElementCheck[];
    error?: string;
  };
  manual: RoverState | null;
  queue: RoverQueueState | null;
  negotiatedCapabilities?: string[];
  lastLeaseRenewalAt?: string;
  lastAssignmentDecision?: { decision: string; reason?: string; at: string };
}

export function createDebugSnapshot(input: DebugSnapshotInput): DebugSnapshot {
  const activeItem = input.queue?.activeItemId
    ? input.queue.items.find((item) => item.queueItemId === input.queue?.activeItemId)
    : undefined;
  return {
    checkedAt: input.checkedAt,
    endpoint: {
      origin: input.origin,
      connected: input.endpointConnected,
      checked: input.endpointChecked !== false,
      ...(input.endpointError ? { error: input.endpointError } : {})
    },
    page: {
      tabId: input.tab?.id,
      url: input.tab?.url,
      matched: input.page?.matched ?? false,
      provider: input.page?.provider,
      profile: input.page?.profile,
      detection: input.page?.detection,
      error: input.page?.error
    },
    elements: input.page?.elements ?? [],
    rover: {
      manualStatus: input.manual?.status,
      queueStatus: input.queue?.status,
      activeQueueItem: activeItem?.name,
      ...(input.negotiatedCapabilities
        ? { negotiatedCapabilities: input.negotiatedCapabilities }
        : {}),
      ...(input.queue?.leaseId ? { leaseId: input.queue.leaseId } : {}),
      ...(input.queue?.leaseState ? { leaseState: input.queue.leaseState } : {}),
      ...(input.queue?.leaseExpiresAt ? { leaseExpiresAt: input.queue.leaseExpiresAt } : {}),
      ...(input.lastLeaseRenewalAt ? { lastLeaseRenewalAt: input.lastLeaseRenewalAt } : {}),
      ...(input.queue?.tabId === undefined ? {} : { boundTabId: input.queue.tabId }),
      ...(input.lastAssignmentDecision
        ? { lastAssignmentDecision: input.lastAssignmentDecision }
        : {})
    }
  };
}
