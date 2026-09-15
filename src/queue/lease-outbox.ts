import type { PendingLeaseAction, RoverQueueState } from './state';

export type LeaseOutboxEvent =
  | { type: 'enqueue'; actions: PendingLeaseAction[] }
  | { type: 'attempt'; at: string }
  | { type: 'acknowledge'; jobId: string; leaseId: string; actionType?: PendingLeaseAction['type'] }
  | { type: 'unknown'; jobId: string; leaseId: string };

export function clearLeaseState(queue: RoverQueueState): RoverQueueState {
  const {
    leaseId: _leaseId,
    leaseExpiresAt: _leaseExpiresAt,
    leaseState: _leaseState,
    pendingLeaseActions: _pendingLeaseActions,
    ...withoutLease
  } = queue;
  return { ...withoutLease, ...(queue.managedPhase ? { managedPhase: 'idle' as const } : {}) };
}

export function leaseOutboxHead(queue: RoverQueueState): PendingLeaseAction | undefined {
  return queue.pendingLeaseActions?.[0];
}

export function leaseOutboxMatches(queue: RoverQueueState, jobId: string, leaseId: string): boolean {
  return queue.queueId === jobId && (queue.leaseId === leaseId || leaseOutboxHead(queue)?.leaseId === leaseId);
}

export function enqueueLeaseActions(queue: RoverQueueState, actions: PendingLeaseAction[]): RoverQueueState {
  return reduceLeaseOutbox(queue, { type: 'enqueue', actions });
}

export function reduceLeaseOutbox(queue: RoverQueueState, event: LeaseOutboxEvent): RoverQueueState {
  if (event.type === 'enqueue') {
    return event.actions.length
      ? { ...clearLeaseState(queue), managedPhase: 'finalizing' as const, pendingLeaseActions: event.actions }
      : clearLeaseState(queue);
  }
  if (event.type === 'attempt') {
    const head = leaseOutboxHead(queue);
    if (!head) return queue;
    return {
      ...queue,
      managedPhase: 'waiting_ack',
      pendingLeaseActions: [{ ...head, attempts: (head.attempts ?? 0) + 1, lastAttemptAt: event.at }, ...queue.pendingLeaseActions!.slice(1)]
    };
  }
  if (!leaseOutboxMatches(queue, event.jobId, event.leaseId)) return queue;
  const head = leaseOutboxHead(queue);
  if (event.type === 'acknowledge' && head && event.actionType && head.type !== event.actionType) return queue;
  if (event.type === 'unknown' || event.type === 'acknowledge') {
    const remaining = queue.pendingLeaseActions?.slice(1) ?? [];
    return remaining.length
      ? { ...queue, managedPhase: 'waiting_ack', pendingLeaseActions: remaining }
      : clearLeaseState(queue);
  }
  return queue;
}
