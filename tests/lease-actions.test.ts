import { describe, expect, it } from 'vitest';
import { clearLease, queueWithPendingLeaseRelease } from '../src/background/lease-transport';
import { createQueue } from '../src/queue/state';
import { reduceLeaseOutbox } from '../src/queue/lease-outbox';

function queue() {
  return {
    ...createQueue('http://127.0.0.1:8787', 'claude', true, '2026-09-15T00:00:00.000Z'),
    queueId: 'job-1',
    leaseId: 'lease-1',
    leaseState: 'running' as const,
    pendingLeaseActions: [
      { type: 'complete' as const, leaseId: 'lease-1', outcome: 'error' },
      { type: 'release' as const, leaseId: 'lease-1', reason: 'error' as const }
    ]
  };
}

describe('pending lease actions', () => {
  it('advances from completion acknowledgement to release', () => {
    const next = reduceLeaseOutbox(queue(), {
      type: 'acknowledge',
      jobId: 'job-1',
      leaseId: 'lease-1',
      actionType: 'complete'
    });
    expect(next.pendingLeaseActions).toEqual([
      { type: 'release', leaseId: 'lease-1', reason: 'error' }
    ]);
  });

  it('clears lease metadata after the final acknowledgement', () => {
    const once = reduceLeaseOutbox(queue(), {
      type: 'acknowledge',
      jobId: 'job-1',
      leaseId: 'lease-1',
      actionType: 'complete'
    });
    const done = reduceLeaseOutbox(once, {
      type: 'acknowledge',
      jobId: 'job-1',
      leaseId: 'lease-1',
      actionType: 'release'
    });
    expect(done.leaseId).toBeUndefined();
    expect(done.pendingLeaseActions).toBeUndefined();
  });

  it('ignores acknowledgements for another job or stale lease', () => {
    const original = queue();
    expect(
      reduceLeaseOutbox(original, {
        type: 'acknowledge',
        jobId: 'job-2',
        leaseId: 'lease-1',
        actionType: 'complete'
      })
    ).toBe(original);
    expect(
      reduceLeaseOutbox(original, {
        type: 'acknowledge',
        jobId: 'job-1',
        leaseId: 'stale',
        actionType: 'complete'
      })
    ).toBe(original);
  });

  it('marks an offline release so a later acknowledgement can clear the queue', () => {
    const pending = queueWithPendingLeaseRelease(queue(), 'stopped', true);
    expect(pending.leaseId).toBeUndefined();
    expect(pending.pendingLeaseActions).toEqual([
      expect.objectContaining({
        type: 'release',
        leaseId: 'lease-1',
        reason: 'stopped',
        clearQueue: true
      })
    ]);
  });

  it('preserves a normal deferred release without requesting queue removal', () => {
    const pending = queueWithPendingLeaseRelease(queue(), 'provider_unavailable');
    expect(pending.pendingLeaseActions?.[0]).toEqual(
      expect.objectContaining({
        type: 'release',
        leaseId: 'lease-1',
        reason: 'provider_unavailable'
      })
    );
    expect(pending.pendingLeaseActions?.[0]?.clearQueue).toBeUndefined();
  });
});
