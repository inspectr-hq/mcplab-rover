import { describe, expect, it } from 'vitest';
import { filterTestCases, formatCheckCounts, modeVisibility } from '../src/popup/view-model';

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
    expect(modeVisibility('manual', false)).toEqual({ catalog: true, session: false, queue: false });
    expect(modeVisibility('manual', true)).toEqual({ catalog: false, session: true, queue: false });
    expect(modeVisibility('queue', false)).toEqual({ catalog: false, session: false, queue: true });
  });
});
