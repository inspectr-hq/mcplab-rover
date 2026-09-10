// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { trendminerAdapter } from '../src/providers/trendminer';
import { claudeAdapter } from '../src/providers/claude';

describe('TrendMiner adapter', () => {
  it('reports semantic element diagnostics', () => {
    document.body.innerHTML = `
      <textarea data-test="ai-agent_input"></textarea>
      <button aria-label="Submit">Submit</button>
      <button aria-label="New chat">New chat</button>
    `;

    expect(trendminerAdapter.getDebugChecks()).toEqual([
      expect.objectContaining({ id: 'composer', present: true }),
      expect.objectContaining({ id: 'submit', present: true }),
      expect.objectContaining({ id: 'assistant-response', present: false }),
      expect.objectContaining({ id: 'new-chat', present: true })
    ]);
  });

  it('reads only visible assistant content and updates the native composer', async () => {
    document.body.innerHTML = `
      <textarea data-test="ai-agent_input"></textarea>
      <button aria-label="Submit">Submit</button>
      <div data-test="chat-messages_message" class="chat-messages__message chat-messages__message--assistant">
        <div class="chat-messages__message-content"><p>Visible answer</p></div>
      </div>
    `;
    const composer = trendminerAdapter.findComposer() as HTMLTextAreaElement;
    let inputEvents = 0;
    composer.addEventListener('input', () => inputEvents++);

    await trendminerAdapter.setComposerText('Injected prompt');

    expect(composer.value).toBe('Injected prompt');
    expect(inputEvents).toBe(1);
    expect(trendminerAdapter.getAssistantCandidates()[0]?.text).toContain('Visible answer');
  });

  it('starts a new conversation through the native New chat control', async () => {
    document.body.innerHTML = `
      <textarea data-test="ai-agent_input"></textarea>
      <button aria-label="New chat">New chat</button>
    `;
    const button = document.querySelector('button')!;
    let clicks = 0;
    button.addEventListener('click', () => clicks++);

    await trendminerAdapter.startNewConversation?.();

    expect(clicks).toBe(1);
  });
});

describe('Claude adapter', () => {
  it('reports missing composer and controls without throwing', () => {
    document.body.innerHTML = '';

    expect(claudeAdapter.getDebugChecks()).toEqual([
      expect.objectContaining({ id: 'composer', present: false }),
      expect.objectContaining({ id: 'submit', present: false }),
      expect.objectContaining({ id: 'assistant-response', present: false })
    ]);
  });

  it('waits for the send button to become enabled after input', async () => {
    document.body.innerHTML = `
      <div contenteditable="true" class="ProseMirror"><p></p></div>
      <button aria-label="Send message" disabled>Send</button>
    `;
    const button = document.querySelector('button')!;
    setTimeout(() => button.removeAttribute('disabled'), 5);

    await claudeAdapter.setComposerText('Injected prompt');
    await claudeAdapter.submit();

    expect(button.hasAttribute('disabled')).toBe(false);
    expect(document.querySelector('.ProseMirror p')?.textContent).toBe('Injected prompt');
  });

  it('captures Claude responses exposed through streaming containers', () => {
    document.body.innerHTML = `
      <div data-is-streaming="false">
        <div class="font-claude-response">Claude answer</div>
      </div>
    `;

    expect(claudeAdapter.getAssistantCandidates().at(-1)?.text).toContain('Claude answer');
  });

  it('considers a completed streaming container idle without requiring a visible send button', () => {
    document.body.innerHTML = `
      <div data-is-streaming="false">
        <div class="font-claude-response">Claude answer</div>
      </div>
    `;
    const candidates = claudeAdapter.getAssistantCandidates();
    const state = claudeAdapter.getResponseState(candidates);

    expect(state.isGenerating).toBe(false);
    expect(state.isIdle).toBe(true);
    expect(state.text).toContain('Claude answer');
  });
});
