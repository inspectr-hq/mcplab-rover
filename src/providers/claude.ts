import type { ChatProviderAdapter } from './types';
import { isVisible, setTextValue, textFrom } from './dom';
import type { ResponseCandidate } from '../runtime/candidate-selection';

const composerSelectors = ['div[contenteditable="true"].ProseMirror', '[contenteditable="true"]'];
const submitSelectors = ['button[aria-label*="Send"]', 'button[aria-label*="send"]'];
const assistantSelectors = [
  '[data-testid="assistant-message"]',
  '[data-is-streaming] [data-testid="message-content"]',
  '[data-testid="message-content"]'
];

function first<T extends Element>(selectors: string[]): T | null {
  for (const selector of selectors) {
    const element = document.querySelector<T>(selector);
    if (element) return element;
  }
  return null;
}

export const claudeAdapter: ChatProviderAdapter = {
  id: 'claude',
  canHandle: () => location.hostname === 'claude.ai',
  findComposer: () => first<HTMLElement>(composerSelectors),
  setComposerText: async (text) => {
    const composer = claudeAdapter.findComposer();
    if (!composer) throw new Error('Claude composer was not found');
    setTextValue(composer, text);
  },
  findSubmitButton: () => first<HTMLButtonElement>(submitSelectors),
  submit: async () => {
    const button = claudeAdapter.findSubmitButton();
    if (!button || button.disabled) throw new Error('Claude submit button is unavailable');
    button.click();
  },
  getAssistantCandidates: () => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(assistantSelectors.join(',')));
    return elements.map((element, index) => ({
      key: element.dataset.messageId || element.dataset.testid || `claude-${index}`,
      text: textFrom(element),
      visible: isVisible(element)
    }));
  },
  getResponseState: (candidates) => {
    const stop = document.querySelector('[aria-label*="Stop"], button[data-is-streaming="true"]');
    const submit = claudeAdapter.findSubmitButton();
    const error = document.querySelector('[role="alert"]')?.textContent?.trim() || null;
    return {
      text: candidates.at(-1)?.text ?? '',
      isGenerating: Boolean(stop),
      isIdle: Boolean(submit && !submit.disabled && !stop),
      error
    };
  }
};
