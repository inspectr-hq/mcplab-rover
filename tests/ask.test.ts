import { describe, expect, it, vi } from 'vitest';
import { ask } from '../src/runtime/ask';
import type { ChatProviderAdapter } from '../src/providers/types';

describe('ask cancellation', () => {
  it('uses a learned profile completion stability window', async () => {
    vi.useFakeTimers();
    try {
      let response = '';
      const adapter = {
        id: 'learned-provider',
        completionStabilityMs: 20,
        getAssistantCandidates: () => response ? [{ key: 'turn-1', text: response, visible: true }] : [],
        setComposerText: vi.fn(async () => undefined),
        submit: vi.fn(async () => { response = 'Final answer'; }),
        getResponseState: (items: Array<{ text: string }>) => ({
          text: items.at(-1)?.text ?? '',
          isGenerating: false,
          isIdle: true
        })
      } as unknown as ChatProviderAdapter;
      let resolved = false;
      const pending = ask(adapter, 'hello').then((text) => {
        resolved = true;
        return text;
      });
      await vi.advanceTimersByTimeAsync(800);
      expect(resolved).toBe(true);
      expect(await pending).toBe('Final answer');
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('marks a learned capture incomplete when generation was never observed', async () => {
    const adapter = {
      id: 'learned-provider',
      requiresGenerationSignal: true,
      getAssistantCandidates: () => [{ key: 'assistant', text: 'A stable answer', visible: true }],
      setComposerText: vi.fn(async () => undefined),
      submit: vi.fn(async () => undefined),
      getResponseState: () => ({ text: 'A stable answer', isGenerating: false, isIdle: true })
    } as unknown as ChatProviderAdapter;

    await expect(ask(adapter, 'hello')).rejects.toMatchObject({
      name: 'IncompleteResponseError',
      code: 'incomplete'
    });
  });

  it('accepts an appended learned response when no generation control is exposed', async () => {
    let response: string | null = null;
    const adapter = {
      id: 'learned-provider',
      requiresGenerationSignal: true,
      getAssistantCandidates: () => [
        { key: 'previous', text: 'Previous answer', visible: true },
        ...(response ? [{ key: 'latest', text: response, visible: true }] : [])
      ],
      setComposerText: vi.fn(async () => undefined),
      submit: vi.fn(async () => {
        response = 'A new stable answer';
      }),
      getResponseState: (items: Array<{ text: string }>) => ({
        text: items.at(-1)?.text ?? '',
        isGenerating: false,
        isIdle: true
      })
    } as unknown as ChatProviderAdapter;

    await expect(ask(adapter, 'hello')).resolves.toBe('A new stable answer');
  });
});
