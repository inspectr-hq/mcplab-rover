// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLearnedAdapter } from '../src/providers/learned';
import { ask } from '../src/runtime/ask';

describe('learned provider execution', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not complete during a long assistant-scoped tool pause without a Stop control', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML = '<textarea></textarea><button aria-label="Send">Send</button>';
    const profile = {
      schemaVersion: 1 as const,
      id: 'no-stop-agent',
      name: 'No Stop Agent',
      match: { origins: [location.origin] },
      composer: { locator: { segments: ['textarea'] }, inputMode: 'textarea' as const },
      submit: { action: 'click' as const, locator: { segments: ['[aria-label="Send"]'] } },
      assistantMessages: { locator: { segments: ['[data-testid="markdown-reply"]'] } },
      completion: {
        stabilityMs: 2500,
        workingLocator: { segments: ['section[aria-busy="true"]'] }
      },
      learned: {
        sourceOrigin: location.origin,
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
        confidence: {}
      }
    };
    const adapter = createLearnedAdapter(profile);
    const send = document.querySelector('button')!;
    send.addEventListener('click', () => {
      const container = document.createElement('section');
      container.setAttribute('aria-busy', 'true');
      container.innerHTML = '<div data-testid="markdown-reply">Partial answer</div>';
      document.body.append(container);
    });
    let resolved = false;
    const pending = ask(adapter, 'Question').then((text) => {
      resolved = true;
      return text;
    });
    await vi.advanceTimersByTimeAsync(3_500);
    expect(resolved).toBe(false);
    const container = document.querySelector('section')!;
    container.querySelector('div')!.textContent = 'Final answer';
    container.setAttribute('aria-busy', 'false');
    await vi.advanceTimersByTimeAsync(2_700);
    expect(await pending).toBe('Final answer');
  });
});
