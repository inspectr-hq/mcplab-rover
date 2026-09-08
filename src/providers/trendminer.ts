import type { ChatProviderAdapter } from './types';
import { isVisible, setTextValue, textFrom } from './dom';

const assistantSelector = '[data-test="chat-messages_message"].chat-messages__message--assistant';

export const trendminerAdapter: ChatProviderAdapter = {
  id: 'trendminer',
  canHandle: () => Boolean(document.querySelector('[data-test="ai-agent_input"]')),
  findComposer: () => document.querySelector<HTMLElement>('[data-test="ai-agent_input"]'),
  setComposerText: async (text) => {
    const composer = trendminerAdapter.findComposer();
    if (!composer) throw new Error('TrendMiner composer was not found');
    setTextValue(composer, text);
  },
  findSubmitButton: () => document.querySelector<HTMLButtonElement>('button[aria-label="Submit"]'),
  submit: async () => {
    const button = trendminerAdapter.findSubmitButton();
    if (!button || button.disabled) throw new Error('TrendMiner submit button is unavailable');
    button.click();
  },
  getAssistantCandidates: () =>
    Array.from(document.querySelectorAll<HTMLElement>(assistantSelector)).map((element, index) => ({
      key: `trendminer-${index}`,
      text: textFrom(element.querySelector('.chat-messages__message-content') || element),
      visible: isVisible(element)
    })),
  getResponseState: (candidates) => {
    const submit = trendminerAdapter.findSubmitButton();
    const error = document.querySelector('[role="alert"]')?.textContent?.trim() || null;
    return {
      text: candidates.at(-1)?.text ?? '',
      isGenerating: Boolean(submit?.disabled),
      isIdle: Boolean(submit && !submit.disabled),
      error
    };
  }
};
