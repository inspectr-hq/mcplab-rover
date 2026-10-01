import { describe, expect, it } from 'vitest';
import {
  selectResponseCandidate,
  type ResponseCandidate
} from '../src/runtime/candidate-selection';

const candidate = (
  text: string,
  overrides: Partial<ResponseCandidate> = {}
): ResponseCandidate => ({
  key: overrides.key ?? text,
  text,
  visible: overrides.visible ?? true,
  ...overrides
});

describe('selectResponseCandidate', () => {
  it('does not mistake an identical rerendered anonymous turn for a new response', () => {
    const baseline = [candidate('Previous answer', { key: 'anonymous:1', ephemeralIdentity: true })];
    const current = [candidate('Previous answer', { key: 'anonymous:2', ephemeralIdentity: true })];
    expect(selectResponseCandidate(baseline, current)).toBeNull();
  });

  it('does not treat a changed same-count anonymous rerender as a new assistant turn', () => {
    const baseline = [candidate('Old answer', { key: 'anonymous:1', ephemeralIdentity: true })];
    const current = [candidate('Old answer, rerendered', { key: 'anonymous:2', ephemeralIdentity: true })];
    expect(selectResponseCandidate(baseline, current)).toBeNull();
  });

  it('accepts an appended anonymous assistant turn when the candidate count grows', () => {
    const baseline = [candidate('Old answer', { key: 'anonymous:1', ephemeralIdentity: true })];
    const current = [
      candidate('Old answer', { key: 'anonymous:1', ephemeralIdentity: true }),
      candidate('New answer', { key: 'anonymous:2', ephemeralIdentity: true })
    ];
    expect(selectResponseCandidate(baseline, current)?.text).toBe('New answer');
  });

  it('selects a new appended visible response instead of an older longer response', () => {
    const baseline = [candidate('A very long previous answer', { key: 'old' })];
    const current = [
      candidate('A very long previous answer', { key: 'old' }),
      candidate('New answer', { key: 'new' })
    ];

    expect(selectResponseCandidate(baseline, current)?.text).toBe('New answer');
  });

  it('does not attribute edits to a pre-existing turn to the newly submitted request', () => {
    const baseline = [candidate('Initial partial answer', { key: 'latest' })];
    const current = [candidate('Updated streamed final answer', { key: 'latest' })];

    expect(selectResponseCandidate(baseline, current)).toBeNull();
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
