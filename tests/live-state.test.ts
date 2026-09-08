import { describe, expect, it } from 'vitest';
import { acceptsContentResult } from '../src/runtime/live-state';

describe('acceptsContentResult', () => {
  it('rejects stale request and session results', () => {
    const state = { requestId: 'new', sessionId: 'session-new' };
    expect(acceptsContentResult(state, { requestId: 'old', sessionId: 'session-new' })).toBe(false);
    expect(acceptsContentResult(state, { requestId: 'new', sessionId: 'session-old' })).toBe(false);
    expect(acceptsContentResult(state, { requestId: 'new', sessionId: 'session-new' })).toBe(true);
  });
});
