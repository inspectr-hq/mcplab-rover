import type { RoverQueueState } from './state';

export function queueNeedsResume(queue: Pick<RoverQueueState, 'status' | 'activeItemId'> & { items: Array<Pick<RoverQueueState['items'][number], 'queueItemId' | 'status'>> }): boolean {
  if (queue.status !== 'running' || !queue.activeItemId) return false;
  return queue.items.find((item) => item.queueItemId === queue.activeItemId)?.status === 'queued';
}
