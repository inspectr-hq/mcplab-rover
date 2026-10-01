import { describe, expect, it } from 'vitest';
import { createDebugSnapshot } from '../src/background/debug';
import { expectedProviderForUrl } from '../src/background/browser';

describe('debug snapshot', () => {
  it('recognizes supported page URLs independently of content-script availability', () => {
    expect(expectedProviderForUrl('https://claude.ai/new')).toBe('claude');
    expect(expectedProviderForUrl('https://claude.ai/chat/example')).toBe('claude');
    expect(expectedProviderForUrl('https://example.com')).toBeUndefined();
  });

  it('combines endpoint, page, element, and Rover state indicators', () => {
    const snapshot = createDebugSnapshot({
      checkedAt: '2026-09-10T09:30:00.000Z',
      origin: 'http://127.0.0.1:8787',
      endpointConnected: true,
      tab: { id: 42, url: 'https://claude.ai/chat/1' },
      page: {
        matched: true,
        provider: 'claude',
        elements: [
          { id: 'composer', label: 'Composer', present: true, detail: 'Found matching element' }
        ]
      },
      manual: null,
      queue: {
        status: 'paused',
        activeItemId: 'item-1',
        items: [
          {
            queueItemId: 'item-1',
            id: 'test',
            testCaseId: 'test',
            name: 'Test evaluation',
            prompt: '',
            assertionCount: 1,
            status: 'error'
          }
        ],
        queueId: 'queue-1',
        mode: 'queue',
        origin: 'http://127.0.0.1:8787',
        provider: 'claude',
        newConversationBetweenItems: false,
        createdAt: '2026-09-10T09:00:00.000Z',
        updatedAt: '2026-09-10T09:30:00.000Z'
      }
    });

    expect(snapshot.endpoint.connected).toBe(true);
    expect(snapshot.page).toMatchObject({ tabId: 42, matched: true, provider: 'claude' });
    expect(snapshot.elements[0]).toMatchObject({ id: 'composer', present: true });
    expect(snapshot.rover).toEqual({ queueStatus: 'paused', activeQueueItem: 'Test evaluation' });
  });

  it('includes negotiated lease diagnostics when available', () => {
    const snapshot = createDebugSnapshot({
      checkedAt: '2026-09-10T09:30:00.000Z',
      origin: 'http://127.0.0.1:8787',
      endpointConnected: true,
      manual: null,
      queue: {
        status: 'running',
        activeItemId: 'item-1',
        queueId: 'queue-1',
        mode: 'queue',
        origin: 'http://127.0.0.1:8787',
        provider: 'claude',
        newConversationBetweenItems: false,
        createdAt: '2026-09-10T09:00:00.000Z',
        updatedAt: '2026-09-10T09:30:00.000Z',
        tabId: 42,
        leaseId: 'lease-1',
        leaseState: 'running',
        leaseExpiresAt: '2026-09-10T09:31:00.000Z',
        items: []
      },
      negotiatedCapabilities: ['assignment_lease'],
      lastLeaseRenewalAt: '2026-09-10T09:30:15.000Z',
      lastAssignmentDecision: { decision: 'accepted', at: '2026-09-10T09:30:00.000Z' }
    });

    expect(snapshot.rover).toMatchObject({
      negotiatedCapabilities: ['assignment_lease'],
      leaseId: 'lease-1',
      leaseState: 'running',
      boundTabId: 42,
      lastAssignmentDecision: { decision: 'accepted' }
    });
  });
});
