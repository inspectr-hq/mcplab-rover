import { describe, expect, it } from 'vitest';
import { roverResultMessage } from '../src/content-result';

describe('content result messages', () => {
  const request = {
    type: 'ROVER_ASK' as const,
    requestId: 'request-1',
    sessionId: 'session-1',
    queueId: 'queue-1',
    queueItemId: 'item-1',
    leaseId: 'lease-1',
    prompt: 'hello'
  };

  it('preserves execution identity for successful results', () => {
    expect(roverResultMessage(request, { ok: true, text: 'answer' })).toEqual({
      type: 'ROVER_RESULT',
      requestId: 'request-1',
      sessionId: 'session-1',
      queueId: 'queue-1',
      queueItemId: 'item-1',
      leaseId: 'lease-1',
      result: { ok: true, text: 'answer' }
    });
  });

  it('preserves structured incomplete errors for queue handling', () => {
    expect(roverResultMessage(request, {
      ok: false,
      error: 'Response capture incomplete',
      code: 'incomplete'
    }).result).toEqual({
      ok: false,
      error: 'Response capture incomplete',
      code: 'incomplete'
    });
  });
});
