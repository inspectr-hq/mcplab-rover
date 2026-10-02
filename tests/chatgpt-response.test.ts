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
