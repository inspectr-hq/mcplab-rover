import { describe, expect, it } from 'vitest';
import { debugFingerprint, filterTestCases, formatCheckCounts, modeVisibility } from '../src/popup/view-model';

const cases = [
  { id: 'alpha', name: 'Restaurant search', tags: ['food'], assertionCount: 2, eligible: true },
  { id: 'beta', name: 'Weather', tags: ['forecast'], assertionCount: 1, eligible: true }
];

describe('popup view model', () => {
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
    expect(modeVisibility('manual', false)).toEqual({ catalog: true, session: false, queue: false, debug: false });
    expect(modeVisibility('manual', true)).toEqual({ catalog: false, session: true, queue: false, debug: false });
    expect(modeVisibility('queue', false)).toEqual({ catalog: false, session: false, queue: true, debug: false });
    expect(modeVisibility('debug', false)).toEqual({ catalog: false, session: false, queue: false, debug: true });
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
});
