import type { QueueItemStatus, RoverQueueItem } from '../queue/state';

export const ROVER_CAPABILITIES = ['scenario_control', 'assignment_lease'] as const;
export const ROVER_PROTOCOL_VERSION = 2 as const;
export const ROVER_LEASE_RELEASE_REASONS = [
  'completed',
  'error',
  'stopped',
  'connection_lost',
  'provider_unavailable',
  'provider_mismatch',
  'stale_provider',
  'bound_tab_unavailable',
  'terminal_error'
] as const;
export type RoverLeaseReleaseReason = (typeof ROVER_LEASE_RELEASE_REASONS)[number];

export function registrationPayload(provider: string, pageUrl: string, extensionVersion: string, providerRevision?: string) {
  return {
    type: 'register' as const,
    protocolVersion: ROVER_PROTOCOL_VERSION,
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
  | { type: 'lease_release'; jobId: string; leaseId: string; reason: RoverLeaseReleaseReason };

export interface LeaseUnknownMessage {
  type: 'lease_unknown';
  jobId: string;
  leaseId: string;
  reason: 'unknown_lease';
}

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
