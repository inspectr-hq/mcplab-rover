import { describe, expect, it } from 'vitest';
import { selectMatchingExecutionTab } from '../src/background/execution-tab';

describe('execution tab selection', () => {
  it('uses the active matching tab when the queue tab belongs to another provider', () => {
    expect(selectMatchingExecutionTab('claude', { id: 10, provider: 'chatgpt-com' }, { id: 20, provider: 'claude' })).toBe(20);
  });

  it('keeps the queue tab when it still matches the assigned provider', () => {
    expect(selectMatchingExecutionTab('claude', { id: 10, provider: 'claude' }, { id: 20, provider: 'claude' })).toBe(10);
  });
});
