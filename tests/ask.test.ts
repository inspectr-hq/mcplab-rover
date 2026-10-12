import { describe, expect, it, vi } from 'vitest';
import { ask } from '../src/runtime/ask';
import type { ChatProviderAdapter } from '../src/providers/types';
import { observationFromCandidates } from '../src/runtime/provider-signals';
import type { ResponseCandidate } from '../src/runtime/candidate-selection';

describe('ask cancellation', () => {
  it('uses the provider signal evaluator directly when one is available', async () => {
    vi.useFakeTimers();
    try {
      let response = '';
      const evaluate = vi.fn((candidates, observedAt) =>
        observationFromCandidates(
          candidates,
          { idle_visible: true, input_enabled: true },
          null,
          'fallback-idle',
          observedAt
        )
      );
      const adapter = {
        id: 'learned-provider',
        completionStabilityMs: 20,
        signalEvaluator: { evaluate },
        getAssistantCandidates: () =>
          response ? [{ key: 'turn-1', text: response, visible: true }] : [],
        setComposerText: vi.fn(async () => undefined),
        submit: vi.fn(async () => {
          response = 'Final answer';
        })
      } as unknown as ChatProviderAdapter;

      const pending = ask(adapter, 'hello');
      await vi.advanceTimersByTimeAsync(800);

      await expect(pending).resolves.toBe('Final answer');
      expect(evaluate).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a learned profile completion stability window', async () => {
    vi.useFakeTimers();
    try {
      let response = '';
      const adapter = {
        id: 'learned-provider',
        completionStabilityMs: 20,
        getAssistantCandidates: () =>
          response ? [{ key: 'turn-1', text: response, visible: true }] : [],
        setComposerText: vi.fn(async () => undefined),
        submit: vi.fn(async () => {
          response = 'Final answer';
        }),
        signalEvaluator: {
          evaluate: (items: ResponseCandidate[], observedAt: number) =>
            observationFromCandidates(
              items,
              { idle_visible: true, input_enabled: true },
              null,
              undefined,
              observedAt
            )
        }
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
      signalEvaluator: {
        evaluate: (items: ResponseCandidate[], observedAt: number) =>
          observationFromCandidates(
            items,
            { idle_visible: true, input_enabled: true },
            null,
            undefined,
            observedAt
          )
      }
    } as unknown as ChatProviderAdapter;

    await expect(ask(adapter, 'hello', controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('marks a learned capture incomplete when generation was never observed', async () => {
    let response = false;
    const adapter = {
      id: 'learned-provider',
      completionStabilityMs: 20,
      requiresGenerationSignal: true,
      getAssistantCandidates: () =>
        response ? [{ key: 'assistant', text: 'A stable answer', visible: true }] : [],
      setComposerText: vi.fn(async () => undefined),
      submit: vi.fn(async () => {
        response = true;
      }),
      signalEvaluator: {
        evaluate: (items: ResponseCandidate[], observedAt: number) => ({
          ...observationFromCandidates(
            items,
            { idle_visible: true, input_enabled: true },
            null,
            undefined,
            observedAt
          ),
          responseObserved: false
        })
      }
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
      signalEvaluator: {
        evaluate: (items: ResponseCandidate[], observedAt: number) =>
          observationFromCandidates(
            items,
            { idle_visible: true, input_enabled: true },
            null,
            undefined,
            observedAt
          )
      }
    } as unknown as ChatProviderAdapter;

    await expect(ask(adapter, 'hello')).resolves.toBe('A new stable answer');
  });
});
