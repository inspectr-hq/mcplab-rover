import { describe, expect, it } from 'vitest';
import { acknowledgePendingLeaseAction, clearLease } from '../src/background/socket';
import { createQueue } from '../src/queue/state';

function queue() {
  return {
    ...createQueue('http://127.0.0.1:8787', 'claude', true, '2026-09-15T00:00:00.000Z'),
    queueId: 'job-1',
    leaseId: 'lease-1',
    leaseState: 'running' as const,
    pendingLeaseActions: [
      { type: 'complete' as const, leaseId: 'lease-1', outcome: 'error' },
      { type: 'release' as const, leaseId: 'lease-1', reason: 'error' }
    ]
  };
}

describe('pending lease actions', () => {
  it('advances from completion acknowledgement to release', () => {
    const next = acknowledgePendingLeaseAction(queue(), 'job-1', 'lease-1');
    expect(next.pendingLeaseActions).toEqual([{ type: 'release', leaseId: 'lease-1', reason: 'error' }]);
  });

  it('clears lease metadata after the final acknowledgement', () => {
    const once = acknowledgePendingLeaseAction(queue(), 'job-1', 'lease-1');
    const done = acknowledgePendingLeaseAction(once, 'job-1', 'lease-1');
    expect(done.leaseId).toBeUndefined();
    expect(done.pendingLeaseActions).toBeUndefined();
  });

  it('ignores acknowledgements for another job or stale lease', () => {
    const original = queue();
    expect(acknowledgePendingLeaseAction(original, 'job-2', 'lease-1')).toBe(original);
    expect(acknowledgePendingLeaseAction(original, 'job-1', 'stale')).toBe(original);
  });

  it('clears legacy pending actions through the same path', () => {
    const original = { ...queue(), pendingLeaseActions: undefined, pendingLeaseAction: { type: 'release' as const, leaseId: 'lease-1', reason: 'stopped' } };
    expect(clearLease(acknowledgePendingLeaseAction(original, 'job-1', 'lease-1')).leaseId).toBeUndefined();
  });
});
