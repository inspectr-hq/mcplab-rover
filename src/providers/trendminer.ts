import type { ChatProviderAdapter } from './types';
import { isVisible, setTextValue, textFrom } from './dom';
import { debugCheck } from './adapter-helpers';

const assistantSelector = '[data-test="chat-messages_message"].chat-messages__message--assistant';

export const trendminerAdapter: ChatProviderAdapter = {
  id: 'trendminer',
  matchesPage: () => location.hostname === 'trendminer.net' || location.hostname.endsWith('.trendminer.net'),
  canHandle: () => Boolean(document.querySelector('[data-test="ai-agent_input"]')),
  getDebugChecks: () => [
    debugCheck('composer', 'Composer', '[data-test="ai-agent_input"]'),
    debugCheck('submit', 'Submit button', 'button[aria-label="Submit"]'),
    debugCheck('assistant-response', 'Assistant response', assistantSelector),
    debugCheck('new-chat', 'New conversation button', 'button[aria-label="New chat"]')
  ],
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
  stopGeneration: async () => {
    document.querySelector<HTMLButtonElement>('button[aria-label*="Stop"], button[aria-label*="Cancel"]')?.click();
  },
  startNewConversation: async () => {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="New chat"]');
    if (!button) throw new Error('TrendMiner New chat button is unavailable');
    button.click();
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      const composer = trendminerAdapter.findComposer();
      const value = composer instanceof HTMLTextAreaElement ? composer.value : composer?.textContent;
      if (composer && !value?.trim()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('TrendMiner new conversation did not become ready');
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
