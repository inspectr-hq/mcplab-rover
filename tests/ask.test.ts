import { describe, expect, it, vi } from 'vitest';
import { ask } from '../src/runtime/ask';
import type { ChatProviderAdapter } from '../src/providers/types';

describe('ask cancellation', () => {
  it('does not submit when cancelled during composer settling', async () => {
    const controller = new AbortController();
    const submit = vi.fn();
    const adapter = {
      id: 'chatgpt-com' as const,
      getAssistantCandidates: () => [],
      setComposerText: vi.fn(async () => {
        setTimeout(() => controller.abort(), 10);
      }),
      submit,
      getResponseState: () => ({ text: '', isGenerating: false, isIdle: true })
    } as unknown as ChatProviderAdapter;

    await expect(ask(adapter, 'hello', controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    });
    expect(submit).not.toHaveBeenCalled();
  });
});
