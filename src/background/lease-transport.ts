import type { RoverQueueState } from '../queue/state';
import { clearLeaseState, enqueueLeaseActions } from '../queue/lease-outbox';
import { saveQueue } from './store';
import type { RoverLeaseReleaseReason } from '../mcplab/rover-protocol';

let socketProvider: () => WebSocket | null = () => null;
let stopRenewal: () => void = () => undefined;
let releaseObserver: (reason: RoverLeaseReleaseReason) => void = () => undefined;

export function configureLeaseTransport(options: {
  getSocket: () => WebSocket | null;
  stopRenewal: () => void;
  onRelease?: (reason: RoverLeaseReleaseReason) => void;
}): void {
  socketProvider = options.getSocket;
  stopRenewal = options.stopRenewal;
  releaseObserver = options.onRelease ?? (() => undefined);
}

export function currentSocket(): WebSocket | null {
  return socketProvider();
}

export function clearLease(queue: RoverQueueState): RoverQueueState {
  return clearLeaseState(queue);
}

function sendLeaseRelease(
  queue: RoverQueueState,
  reason: RoverLeaseReleaseReason
): RoverQueueState {
  if (!queue.leaseId) return queue;
  const socket = currentSocket();
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: 'lease_release',
        jobId: queue.queueId,
        leaseId: queue.leaseId,
        reason
      })
    );
  }
  releaseObserver(reason);
  if (reason !== 'connection_lost') stopRenewal();
  return clearLease(queue);
}

export function queueWithPendingLeaseRelease(
  queue: RoverQueueState,
  reason: RoverLeaseReleaseReason,
  clearQueue = false
): RoverQueueState {
  if (!queue.leaseId) return clearLease(queue);
  return enqueueLeaseActions(clearLease(queue), [
    {
      type: 'release',
      leaseId: queue.leaseId,
      reason,
      firstQueuedAt: new Date().toISOString(),
      ...(clearQueue ? { clearQueue: true } : {})
    }
  ]);
}

export async function persistLeaseRelease(
  queue: RoverQueueState,
  reason: RoverLeaseReleaseReason,
  clearQueue = false,
  replacement?: RoverQueueState
): Promise<RoverQueueState> {
  const target = replacement ?? queue;
  const releaseSource = queue.leaseId ? queue : target;
  if (!releaseSource.leaseId) {
    const released = clearLease(target);
    await saveQueue(released);
    return released;
  }
  if (currentSocket()?.readyState === WebSocket.OPEN) {
    const released = clearLease(target);
    await saveQueue(released);
    sendLeaseRelease(releaseSource, reason);
    return released;
  }
  const pending = queueWithPendingLeaseRelease(
    { ...target, leaseId: releaseSource.leaseId },
    reason,
    clearQueue
  );
  await saveQueue(pending);
  return pending;
}
