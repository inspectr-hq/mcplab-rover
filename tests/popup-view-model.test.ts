import { describe, expect, it } from 'vitest';
import {
  debugFingerprint,
  debugCheckedLabel,
  filterTestCases,
  formatCheckCounts,
  managedPhaseLabel,
  learnResultStatus,
  modeVisibility,
  profileSummary,
  projectQueueForProvider,
  splitQueueItems,
  suggestedProviderName
} from '../src/popup/view-model';

const cases = [
  { id: 'alpha', name: 'Restaurant search', tags: ['food'], assertionCount: 2, eligible: true },
  { id: 'beta', name: 'Weather', tags: ['forecast'], assertionCount: 1, eligible: true }
];

describe('popup view model', () => {
  it('shows the working locator separately in a learned profile summary', () => {
    const entries = profileSummary({
      id: 'copilot',
      schemaVersion: 1,
      name: 'Copilot',
      match: { origins: ['https://copilot.example'] },
      composer: { locator: { segments: ['textarea'] }, inputMode: 'contenteditable' },
      submit: { action: 'enter' },
      assistantMessages: { locator: { segments: ['[data-testid="markdown-reply"]'] } },
      completion: {
        generatingLocator: { segments: ['[aria-label="Stop generating"]'] },
        workingLocator: { segments: ['div[aria-busy="true"]'] },
        stabilityMs: 2_500
      },
      learned: {
        sourceOrigin: 'https://copilot.example',
        createdAt: '2026-09-21T00:00:00.000Z',
        updatedAt: '2026-09-21T00:00:00.000Z',
        confidence: {}
      }
    });

    expect(entries).toContainEqual({ label: 'Working', value: 'div[aria-busy="true"]' });
  });

  it('guides the next Learning action when New Chat has not been confirmed', () => {
    expect(learnResultStatus({
      readyToSave: true,
      hasNewConversation: true,
      newConversationContextObserved: false
    })).toContain('click New Chat');
    expect(learnResultStatus({
      readyToSave: true,
      hasNewConversation: true,
      newConversationContextObserved: true
    })).toContain('New Chat context change observed');
  });

  it('labels diagnostic timestamps as checked time', () => {
    expect(debugCheckedLabel('2026-09-10T09:30:00.000Z')).toMatch(/^Last checked /);
  });

  it('filters by name, id, and tag without case sensitivity', () => {
    expect(filterTestCases(cases, 'FOOD').map((item) => item.id)).toEqual(['alpha']);
    expect(filterTestCases(cases, 'beta').map((item) => item.id)).toEqual(['beta']);
  });

  it('formats evaluated and unobserved checks', () => {
    expect(formatCheckCounts({ passed: 2, failed: 1, not_evaluated: 3, total: 6 })).toBe(
      '2 passed · 1 failed · 3 not evaluated'
    );
  });

  it('shows only the controls for the active mode', () => {
    expect(modeVisibility('manual', false)).toEqual({
      catalog: true,
      session: false,
      queue: false,
      debug: false
    });
    expect(modeVisibility('manual', true)).toEqual({
      catalog: false,
      session: true,
      queue: false,
      debug: false
    });
    expect(modeVisibility('queue', false)).toEqual({
      catalog: false,
      session: false,
      queue: true,
      debug: false
    });
    expect(modeVisibility('debug', false)).toEqual({
      catalog: false,
      session: false,
      queue: false,
      debug: true
    });
  });

  it('labels managed lease phases for the popup', () => {
    expect(managedPhaseLabel('running')).toBe('Running in agent');
    expect(managedPhaseLabel('waiting_ack')).toBe('Waiting for MCPLab acknowledgement');
    expect(managedPhaseLabel('idle')).toBeUndefined();
  });

  it('ignores diagnostic check timestamps when comparing snapshots', () => {
    const first = {
      checkedAt: '2026-09-10T09:30:00.000Z',
      endpoint: { origin: 'http://127.0.0.1:8787', connected: true, checked: true },
      page: { tabId: 1, url: 'https://claude.ai', matched: true, provider: 'claude' as const },
      elements: [{ id: 'composer', label: 'Composer', present: true, detail: 'Found' }],
      rover: { manualStatus: 'ready' as const }
    };
    const second = { ...first, checkedAt: '2026-09-10T09:30:02.000Z' };
    const changed = { ...second, page: { ...second.page, matched: false } };

    expect(debugFingerprint(first)).toBe(debugFingerprint(second));
    expect(debugFingerprint(first)).not.toBe(debugFingerprint(changed));
  });

  it('separates completed queue items from active items', () => {
    const items = [
      {
        queueItemId: '1',
        testCaseId: 'a',
        id: 'a',
        name: 'A',
        prompt: '',
        assertionCount: 0,
        status: 'passed' as const
      },
      {
        queueItemId: '2',
        testCaseId: 'b',
        id: 'b',
        name: 'B',
        prompt: '',
        assertionCount: 0,
        status: 'queued' as const
      },
      {
        queueItemId: '3',
        testCaseId: 'c',
        id: 'c',
        name: 'C',
        prompt: '',
        assertionCount: 0,
        status: 'running' as const
      }
    ];
    expect(splitQueueItems(items)).toEqual({
      active: [items[1], items[2]],
      completed: [items[0]],
      managed: false
    });
  });

  it('identifies queues managed by MCPLab', () => {
    expect(splitQueueItems([], 'run-123').managed).toBe(true);
    expect(splitQueueItems([], undefined).managed).toBe(false);
  });

  it('suggests the captured provider name for the learning form', () => {
    expect(
      suggestedProviderName({ name: 'chatgpt.com', match: { origins: ['https://chatgpt.com'] } })
    ).toBe('chatgpt.com');
    expect(suggestedProviderName({ name: '', match: { origins: ['https://example.com'] } })).toBe(
      'example.com'
    );
  });

  it('projects only the active provider queue and its recent history', () => {
    const claudeItem = {
      queueItemId: 'claude-1',
      testCaseId: 'a',
      id: 'a',
      name: 'Claude',
      prompt: '',
      assertionCount: 0,
      status: 'passed' as const
    };
    const copilotItem = {
      queueItemId: 'copilot-1',
      testCaseId: 'b',
      id: 'b',
      name: 'Copilot',
      prompt: '',
      assertionCount: 0,
      status: 'passed' as const
    };
    const queue = {
      provider: 'claude',
      evaluationRunId: 'run-1',
      items: [claudeItem],
      recentHistory: { claude: [claudeItem], copilot: [copilotItem] }
    };
    expect(projectQueueForProvider(queue, 'claude')).toMatchObject({
      matchesCurrentAssignment: true,
      active: [],
      completed: [claudeItem],
      managed: true
    });
    expect(projectQueueForProvider(queue, 'copilot')).toMatchObject({
      matchesCurrentAssignment: false,
      active: [],
      completed: [copilotItem],
      managed: true
    });
  });

  it('keeps a managed assignment visible when the current page is another provider', () => {
    const queued = {
      queueItemId: 'm365-1',
      testCaseId: 'a',
      id: 'a',
      name: 'M365 scenario',
      prompt: '',
      assertionCount: 0,
      status: 'queued' as const
    };
    const queue = { provider: 'm365-cloud-microsoft', evaluationRunId: 'run-1', items: [queued] };
    expect(projectQueueForProvider(queue, 'claude')).toMatchObject({
      matchesCurrentAssignment: false,
      active: [queued],
      managed: true
    });
  });
});
