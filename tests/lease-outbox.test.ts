import { describe, expect, it } from 'vitest';
import { leaseOutboxHead, reduceLeaseOutbox } from '../src/queue/lease-outbox';
import { createQueue } from '../src/queue/state';

function queue() {
  return {
    ...createQueue('http://127.0.0.1:8787', 'claude', true, '2026-09-15T00:00:00.000Z'),
    queueId: 'job-1',
    leaseId: 'lease-1',
    leaseState: 'running' as const
  };
}

describe('lease outbox reducer', () => {
  it('enqueues actions and advances only after a matching acknowledgement', () => {
    const initial = reduceLeaseOutbox(queue(), {
      type: 'enqueue',
      actions: [
        { type: 'complete', leaseId: 'lease-1', outcome: 'error' },
        { type: 'release', leaseId: 'lease-1', reason: 'terminal_error' }
      ]
    });
    const unchanged = reduceLeaseOutbox(initial, { type: 'acknowledge', jobId: 'job-1', leaseId: 'lease-1', actionType: 'release' });
    expect(unchanged).toBe(initial);
    expect(initial.managedPhase).toBe('finalizing');
    const attempted = reduceLeaseOutbox(initial, { type: 'attempt', at: '2026-09-15T00:00:01.000Z' });
    expect(attempted.managedPhase).toBe('waiting_ack');
    const next = reduceLeaseOutbox(attempted, { type: 'acknowledge', jobId: 'job-1', leaseId: 'lease-1', actionType: 'complete' });
    expect(leaseOutboxHead(next)?.type).toBe('release');
    expect(next.managedPhase).toBe('waiting_ack');
  });

  it('clears lease state on the final acknowledgement or unknown-lease response', () => {
    const pending = reduceLeaseOutbox(queue(), { type: 'enqueue', actions: [{ type: 'release', leaseId: 'lease-1', reason: 'completed' }] });
    const acknowledged = reduceLeaseOutbox(pending, { type: 'acknowledge', jobId: 'job-1', leaseId: 'lease-1', actionType: 'release' });
    expect(acknowledged.leaseId).toBeUndefined();
    expect(acknowledged.managedPhase).toBe('idle');
    const unknown = reduceLeaseOutbox(pending, { type: 'unknown', jobId: 'job-1', leaseId: 'lease-1' });
    expect(unknown.leaseId).toBeUndefined();
    expect(unknown.pendingLeaseActions).toBeUndefined();
  });

  it('ignores stale events for another job or lease', () => {
    const pending = reduceLeaseOutbox(queue(), { type: 'enqueue', actions: [{ type: 'release', leaseId: 'lease-1', reason: 'completed' }] });
    expect(reduceLeaseOutbox(pending, { type: 'unknown', jobId: 'job-2', leaseId: 'lease-1' })).toBe(pending);
    expect(reduceLeaseOutbox(pending, { type: 'acknowledge', jobId: 'job-1', leaseId: 'stale', actionType: 'release' })).toBe(pending);
  });
});
