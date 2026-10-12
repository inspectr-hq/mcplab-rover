// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatgptAdapter } from '../src/providers/chatgpt';
import { selectResponseCandidate } from '../src/runtime/candidate-selection';
import { waitForCompletedResponse } from '../src/runtime/response-tracker';

function response(id: string, text = 'The answer') {
  return `<div data-chatgpt-selection-message-id="${id}">
    <div data-markdown-text-style="assistant-message">${text}</div>
  </div>`;
}

describe('ChatGPT current response markup', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML = '<div contenteditable="true" aria-label="Ask ChatGPT"></div>';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('waits for the new chat composer instead of returning after the click', async () => {
    vi.useFakeTimers();
    document.body.insertAdjacentHTML(
      'beforeend',
      response('old-answer') + '<button aria-label="New chat">New chat</button>'
    );
    const oldComposer = chatgptAdapter.findComposer()!;
    document.querySelector('button')!.addEventListener('click', () => {
      setTimeout(() => {
        document.body.innerHTML = '<div contenteditable="true" aria-label="Ask ChatGPT"></div>';
      }, 500);
    });
    let ready = false;
    const pending = chatgptAdapter.startNewConversation!().then(() => {
      ready = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    await chatgptAdapter.setComposerText('MCPLab prompt');
    expect(chatgptAdapter.findComposer()?.textContent).toBe('MCPLab prompt');
    expect(oldComposer.textContent).toBe('');
    expect(oldComposer.isConnected).toBe(false);
  });

  it('accepts a cleared draft on an already empty chat', async () => {
    vi.useFakeTimers();
    const composer = chatgptAdapter.findComposer()!;
    composer.textContent = 'Leftover draft';
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button aria-label="New chat">New chat</button>'
    );
    document.querySelector('button')!.addEventListener('click', () => {
      setTimeout(() => {
        composer.textContent = '';
      }, 100);
    });
    const pending = chatgptAdapter.startNewConversation!();
    const outcome = pending.then(
      () => 'ready',
      (error: Error) => error.message
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await outcome).toBe('ready');
    await chatgptAdapter.setComposerText('MCPLab prompt');
    expect(composer.textContent).toBe('MCPLab prompt');
  });

  it('confirms a new empty chat when the previous answer is retained but hidden', async () => {
    vi.useFakeTimers();
    document.body.insertAdjacentHTML(
      'beforeend',
      response('cached-answer') + '<button aria-label="New chat">New chat</button>'
    );
    const previous = document.querySelector<HTMLElement>(
      '[data-markdown-text-style="assistant-message"]'
    )!;
    document.querySelector('button')!.addEventListener('click', () => {
      setTimeout(() => {
        previous.style.display = 'none';
      }, 100);
    });
    const outcome = chatgptAdapter.startNewConversation!().then(
      () => 'ready',
      (error: Error) => error.message
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await outcome).toBe('ready');
    expect(previous.isConnected).toBe(true);
    expect(chatgptAdapter.getAssistantCandidates()).toMatchObject([{ visible: false }]);
  });

  it('recognizes an already empty chat despite hidden cached answers', async () => {
    vi.useFakeTimers();
    document.body.insertAdjacentHTML(
      'beforeend',
      response('cached-answer') + '<button aria-label="New chat">New chat</button>'
    );
    document.querySelector<HTMLElement>(
      '[data-markdown-text-style="assistant-message"]'
    )!.style.display = 'none';
    const clicked = vi.fn();
    document.querySelector('button')!.addEventListener('click', clicked);
    const outcome = chatgptAdapter.startNewConversation!().then(
      () => 'ready',
      (error: Error) => error.message
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await outcome).toBe('ready');
    expect(clicked).not.toHaveBeenCalled();
  });

  it('captures every block of the latest answer as one candidate', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      response('old-answer', 'Old answer') +
        `
      <div data-chatgpt-selection-message-id="new-answer">
        <div data-markdown-text-style="assistant-message"><p>First block</p><p>Second paragraph</p></div>
        <button aria-label="Copy">Copy</button>
        <div data-markdown-text-style="assistant-message">Last block</div>
      </div>`
    );
    const candidates = chatgptAdapter.getAssistantCandidates();
    expect(candidates).toHaveLength(2);
    expect(candidates.at(-1)?.text).toContain('First block');
    expect(candidates.at(-1)?.text).toContain('Second paragraph');
    expect(candidates.at(-1)?.text).toContain('Last block');
    expect(candidates.at(-1)?.text).not.toContain('Copy');
    expect(selectResponseCandidate(candidates.slice(0, 1), candidates)?.text).toBe(
      candidates.at(-1)?.text
    );
  });

  it('does not accept clearing a draft while the old answer remains', async () => {
    vi.useFakeTimers();
    const composer = chatgptAdapter.findComposer()!;
    composer.textContent = 'Draft';
    document.body.insertAdjacentHTML(
      'beforeend',
      response('old-answer') + '<button aria-label="New chat">New chat</button>'
    );
    document.querySelector('button')!.addEventListener('click', () => {
      composer.textContent = '';
    });
    const outcome = chatgptAdapter.startNewConversation!().then(
      () => 'ready',
      (error: Error) => error.message
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await outcome).toContain('new conversation did not become ready');
  });

  it('captures every legacy response block without nesting duplicates or hidden copies', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <div data-message-author-role="assistant" data-message-id="legacy-answer">
        <div data-markdown-text-style="assistant-message">First block</div>
        <div data-markdown-text-style="assistant-message">Last block</div>
        <div data-markdown-text-style="assistant-message" style="display:none">Hidden copy</div>
      </div>`
    );
    expect(chatgptAdapter.getAssistantCandidates()).toEqual([
      { key: 'legacy-answer', text: 'First block\n\nLast block', visible: true }
    ]);
  });

  it('captures answer content without user text, headings, or action controls', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <div data-user-message-bubble="true">The prompt</div>
      <h4 data-conversation-role="assistant">ChatGPT said:</h4>
      ${response('answer-1')}
      <button aria-label="Copy">Copy</button>
    `
    );
    expect(chatgptAdapter.getAssistantCandidates()).toEqual([
      { key: 'answer-1', text: 'The answer', visible: true }
    ]);
    expect(
      chatgptAdapter.getDebugChecks().find((check) => check.id === 'assistant-response')?.present
    ).toBe(true);
  });

  it('does not count nested legacy and current markers twice', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div data-message-author-role="assistant" data-message-id="legacy-id">
        <div data-markdown-text-style="assistant-message">The answer</div>
      </div>`
    );
    expect(chatgptAdapter.getAssistantCandidates()).toEqual([
      { key: 'legacy-id', text: 'The answer', visible: true }
    ]);
  });

  it('preserves identity on rerender and recognizes identical replies after virtualization', () => {
    document.body.innerHTML = response('answer-1');
    const baseline = chatgptAdapter.getAssistantCandidates();
    document.body.innerHTML = response('answer-1');
    expect(selectResponseCandidate(baseline, chatgptAdapter.getAssistantCandidates())).toBeNull();
    document.body.innerHTML = response('answer-2');
    expect(selectResponseCandidate(baseline, chatgptAdapter.getAssistantCandidates())?.key).toBe(
      'answer-2'
    );
  });

  it('finishes capturing current markup after generation stops and the answer stabilizes', async () => {
    vi.useFakeTimers();
    document.body.insertAdjacentHTML(
      'beforeend',
      response('answer-1') + '<button aria-label="Stop"></button>'
    );
    const pending = waitForCompletedResponse({
      readObservation: () =>
        chatgptAdapter.signalEvaluator.evaluate(
          chatgptAdapter.getAssistantCandidates(),
          Date.now()
        ),
      pollMs: 100,
      stabilityMs: 2500,
      minResponseAgeMs: 500,
      timeoutMs: 10000
    });
    let completed = false;
    void pending.then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(completed).toBe(false);
    document.querySelector('button')!.remove();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBe('The answer');
  });
});
