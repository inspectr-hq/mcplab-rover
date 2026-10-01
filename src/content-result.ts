import type { ExtensionMessage } from './contracts';

export function roverResultMessage(
  request: Extract<ExtensionMessage, { type: 'ROVER_ASK' }>,
  result: Extract<ExtensionMessage, { type: 'ROVER_RESULT' }>['result']
): Extract<ExtensionMessage, { type: 'ROVER_RESULT' }> {
  return {
    type: 'ROVER_RESULT',
    requestId: request.requestId,
    sessionId: request.sessionId,
    ...(request.queueId ? { queueId: request.queueId } : {}),
    ...(request.queueItemId ? { queueItemId: request.queueItemId } : {}),
    ...(request.leaseId ? { leaseId: request.leaseId } : {}),
    result
  };
}
