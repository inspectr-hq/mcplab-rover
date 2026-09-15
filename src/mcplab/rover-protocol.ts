import type { QueueItemStatus, RoverQueueItem } from '../queue/state';

export const ROVER_CAPABILITIES = ['scenario_control', 'assignment_lease'] as const;

export function registrationPayload(provider: string, pageUrl: string, extensionVersion: string, providerRevision?: string) {
  return {
    type: 'register' as const,
    protocolVersion: 1 as const,
    capabilities: ROVER_CAPABILITIES,
    provider,
    pageUrl,
    extensionVersion,
    ...(providerRevision ? { providerRevision } : {})
  };
}

export type ScenarioWireStatus = 'queued' | 'running' | 'completed' | 'error' | 'stopped';

export interface ScenarioStatusEvent {
  type: 'scenario_status';
  jobId?: string;
  scenarioId?: string;
  leaseId?: string;
  status: ScenarioWireStatus;
  completed: number;
  total: number;
  lastDurationMs?: number;
  error?: string;
}

export type LeaseMessage =
  | { type: 'assignment_accept'; jobId: string; leaseId: string; tabId?: number }
  | { type: 'assignment_reject'; jobId: string; leaseId: string; reason: string; retryable: boolean }
  | { type: 'lease_renew'; jobId: string; leaseId: string; leaseExpiresAt: string }
  | { type: 'lease_release'; jobId: string; leaseId: string; reason: 'completed' | 'error' | 'stopped' | 'connection_lost' };

export function scenarioStatusForItem(item: Pick<RoverQueueItem, 'status' | 'error'> | { status: QueueItemStatus; error?: string }): Omit<ScenarioStatusEvent, 'type' | 'jobId' | 'scenarioId'> {
  const status: ScenarioWireStatus = item.status === 'queued'
    ? 'queued'
    : item.status === 'running' || item.status === 'evaluating'
      ? 'running'
      : item.status === 'stopped'
        ? 'stopped'
        : item.status === 'error'
          ? 'error'
          : 'completed';
  return {
    status,
    completed: status === 'queued' || status === 'running' ? 0 : 1,
    total: 1,
    ...(status === 'error' && item.error ? { error: item.error } : {})
  };
}
