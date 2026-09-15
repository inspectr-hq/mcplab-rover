import { describe, expect, it } from 'vitest';
import { createQueue } from '../src/queue/state';
import { transitionManagedLease } from '../src/queue/managed-lease';

function queue() {
  return createQueue('http://127.0.0.1:8787', 'claude', true, '2026-09-15T00:00:00.000Z');
}

describe('managed lease transitions', () => {
  it('moves an offer through accepted to running', () => {
    const offered = transitionManagedLease(queue(), { type: 'offer', leaseId: 'lease-1', leaseExpiresAt: '2026-09-15T00:00:30.000Z' });
    const accepted = transitionManagedLease(offered, { type: 'accepted', leaseId: 'lease-1' });
    const running = transitionManagedLease(accepted, { type: 'running', leaseId: 'lease-1' });
    expect(offered.leaseState).toBe('offered');
    expect(accepted.leaseState).toBe('accepted');
    expect(running.leaseState).toBe('running');
  });

  it('ignores stale or out-of-order transitions', () => {
    const offered = transitionManagedLease(queue(), { type: 'offer', leaseId: 'lease-1', leaseExpiresAt: '2026-09-15T00:00:30.000Z' });
    expect(transitionManagedLease(offered, { type: 'running', leaseId: 'lease-1' })).toBe(offered);
    expect(transitionManagedLease(offered, { type: 'accepted', leaseId: 'stale' })).toBe(offered);
  });

  it('does not overwrite an active lease with a new offer', () => {
    const offered = transitionManagedLease(queue(), { type: 'offer', leaseId: 'lease-1', leaseExpiresAt: '2026-09-15T00:00:30.000Z' });
    expect(transitionManagedLease(offered, { type: 'offer', leaseId: 'lease-2', leaseExpiresAt: '2026-09-15T00:00:30.000Z' })).toBe(offered);
  });

  it('renews only an accepted or running lease', () => {
    const offered = transitionManagedLease(queue(), { type: 'offer', leaseId: 'lease-1', leaseExpiresAt: '2026-09-15T00:00:30.000Z' });
    expect(transitionManagedLease(offered, { type: 'renewed', leaseId: 'lease-1', leaseExpiresAt: '2026-09-15T00:01:00.000Z' })).toBe(offered);
    const running = transitionManagedLease(transitionManagedLease(offered, { type: 'accepted', leaseId: 'lease-1' }), { type: 'running', leaseId: 'lease-1' });
    expect(transitionManagedLease(running, { type: 'renewed', leaseId: 'lease-1', leaseExpiresAt: '2026-09-15T00:01:00.000Z' }).leaseExpiresAt).toBe('2026-09-15T00:01:00.000Z');
  });

  it('invalidates a matching lease and preserves unrelated queue data', () => {
    const original = queue();
    const offered = transitionManagedLease(original, { type: 'offer', leaseId: 'lease-1', leaseExpiresAt: '2026-09-15T00:00:30.000Z' });
    const cleared = transitionManagedLease(offered, { type: 'invalidate', leaseId: 'lease-1' });
    expect(cleared.leaseId).toBeUndefined();
    expect(cleared.queueId).toBe(original.queueId);
  });
});
