import type { RoverQueueState } from './state';
import { clearLeaseState, leaseOutboxHead } from './lease-outbox';

export type ManagedLeaseEvent =
  | { type: 'offer'; leaseId: string; leaseExpiresAt: string }
  | { type: 'accepted'; leaseId: string }
  | { type: 'running'; leaseId: string }
  | { type: 'renewed'; leaseId: string; leaseExpiresAt: string }
  | { type: 'invalidate'; leaseId: string };

function matches(queue: RoverQueueState, leaseId: string): boolean {
  return queue.leaseId === leaseId || leaseOutboxHead(queue)?.leaseId === leaseId;
}

export function transitionManagedLease(
  queue: RoverQueueState,
  event: ManagedLeaseEvent
): RoverQueueState {
  if (event.type === 'offer') {
    if (queue.leaseId || queue.pendingLeaseActions?.length) return queue;
    return {
      ...queue,
      leaseId: event.leaseId,
      leaseExpiresAt: event.leaseExpiresAt,
      leaseState: 'offered',
      managedPhase: 'offered'
    };
  }
  if (!matches(queue, event.leaseId)) return queue;
  if (event.type === 'accepted') {
    if (queue.leaseState !== 'offered') return queue;
    return { ...queue, leaseState: 'accepted', managedPhase: 'accepted' };
  }
  if (event.type === 'running') {
    if (queue.leaseState !== 'accepted' && queue.leaseState !== 'running') return queue;
    return { ...queue, leaseState: 'running', managedPhase: 'running' };
  }
  if (event.type === 'renewed') {
    if (queue.leaseState !== 'accepted' && queue.leaseState !== 'running') return queue;
    return { ...queue, leaseExpiresAt: event.leaseExpiresAt, updatedAt: new Date().toISOString() };
  }
  return clearLeaseState(queue);
}
