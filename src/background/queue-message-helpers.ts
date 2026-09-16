import type { ProviderId, RoverStage } from '../contracts';
import { McplabClient } from '../mcplab/api-client';
import { createQueue, type RoverQueueState } from '../queue/state';
import { currentSocket } from './lease-transport';

export function createQueueForMessage(origin: string, provider: ProviderId, newConversationBetweenItems: boolean): RoverQueueState {
  return createQueue(origin, provider, newConversationBetweenItems, new Date().toISOString());
}

export async function supportsNewConversation(provider: ProviderId | undefined, origin: string): Promise<boolean> {
  if (provider === 'claude' || provider === 'chatgpt-com' || provider === 'trendminer') return true;
  if (!provider) return false;
  try {
    const profile = (await new McplabClient(origin).listBrowserProviders()).find((candidate) => candidate.id === provider);
    return Boolean(profile?.newConversation);
  } catch {
    return false;
  }
}

export function sendQueueStage(queue: RoverQueueState, scenarioId: string, stage: RoverStage): void {
  const socket = currentSocket();
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'stage', jobId: queue.queueId, scenarioId, stage, ...(queue.leaseId ? { leaseId: queue.leaseId } : {}) }));
  }
}
