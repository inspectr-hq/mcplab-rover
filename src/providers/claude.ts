import type { ChatProviderAdapter } from './types';
import { isVisible, textFrom } from './dom';
import type { ResponseCandidate } from '../runtime/candidate-selection';

const composerSelectors = ['div[contenteditable="true"].ProseMirror', '[contenteditable="true"]'];
const submitSelectors = [
  'button[aria-label="Send message"]',
  'button[aria-label*="Send"]:not([aria-label*="Toggle"])',
  'button[aria-label*="send"]:not([aria-label*="Toggle"])'
];
const assistantSelectors = [
  '[data-is-streaming]',
  'div[class*="font-claude-response"]',
  'div[class*="font-claude"]',
  '[data-testid="assistant-message"]',
  '[data-testid="message-content"]'
];

function first<T extends Element>(selectors: string[]): T | null {
  for (const selector of selectors) {
    const element = document.querySelector<T>(selector);
    if (element) return element;
  }
  return null;
}

async function waitForEnabledButton(timeoutMs = 3000): Promise<HTMLButtonElement> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const button = claudeAdapter.findSubmitButton();
    if (button && !button.disabled) return button;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Claude submit button is unavailable');
}

export const claudeAdapter: ChatProviderAdapter = {
  id: 'claude',
  canHandle: () => location.hostname === 'claude.ai',
  findComposer: () => first<HTMLElement>(composerSelectors),
  setComposerText: async (text) => {
    const composer = claudeAdapter.findComposer();
    if (!composer) throw new Error('Claude composer was not found');
    composer.focus();
    const paragraph = composer.querySelector('p') || document.createElement('p');
    paragraph.textContent = text;
    if (!paragraph.parentElement) composer.replaceChildren(paragraph);
    composer.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    composer.dispatchEvent(new Event('change', { bubbles: true }));
  },
  findSubmitButton: () => first<HTMLButtonElement>(submitSelectors),
  submit: async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const button = await waitForEnabledButton();
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
    const isGenerating = Boolean(stop || document.querySelector('[data-is-streaming="true"]'));
    const hasCompletedContainer = Boolean(document.querySelector('[data-is-streaming="false"]'));
    return {
      text: candidates.at(-1)?.text ?? '',
      isGenerating,
      isIdle: !isGenerating && (hasCompletedContainer || Boolean(submit && !submit.disabled)),
      error
    };
  }
};
