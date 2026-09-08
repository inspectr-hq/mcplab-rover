// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { trendminerAdapter } from '../src/providers/trendminer';

describe('TrendMiner adapter', () => {
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
});
