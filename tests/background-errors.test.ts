import { describe, expect, it } from 'vitest';
import { errorMessage } from '../src/background/errors';

describe('background error formatting', () => {
  it('uses Error messages and stringifies other thrown values', () => {
    expect(errorMessage(new Error('connection failed'))).toBe('connection failed');
    expect(errorMessage('connection failed')).toBe('connection failed');
    expect(errorMessage({ code: 503 })).toBe('[object Object]');
  });
});
