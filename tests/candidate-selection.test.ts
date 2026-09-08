import { describe, expect, it } from 'vitest';
import { selectResponseCandidate, type ResponseCandidate } from '../src/runtime/candidate-selection';

const candidate = (text: string, overrides: Partial<ResponseCandidate> = {}): ResponseCandidate => ({
  key: overrides.key ?? text,
  text,
  visible: overrides.visible ?? true,
  ...overrides
});

describe('selectResponseCandidate', () => {
  it('selects a new appended visible response instead of an older longer response', () => {
    const baseline = [candidate('A very long previous answer', { key: 'old' })];
    const current = [
      candidate('A very long previous answer', { key: 'old' }),
      candidate('New answer', { key: 'new' })
    ];

    expect(selectResponseCandidate(baseline, current)?.text).toBe('New answer');
  });

  it('selects a changed latest response node while it streams', () => {
    const baseline = [candidate('Initial partial answer', { key: 'latest' })];
    const current = [candidate('Updated streamed final answer', { key: 'latest' })];

    expect(selectResponseCandidate(baseline, current)?.text).toBe('Updated streamed final answer');
  });

  it('ignores unchanged, hidden, and empty candidates', () => {
    const baseline = [candidate('Previous answer', { key: 'old' })];
    const current = [
      candidate('Previous answer', { key: 'old' }),
      candidate('Hidden answer', { key: 'hidden', visible: false }),
      candidate('   ', { key: 'blank' })
    ];

    expect(selectResponseCandidate(baseline, current)).toBeNull();
  });
});
