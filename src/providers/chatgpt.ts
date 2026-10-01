import type { ChatProviderAdapter } from './types';
import { isVisible, setTextValue, textFrom } from './dom';
import { debugCheck, first, pageAlertText } from './adapter-helpers';
import { observationFromCandidates } from '../runtime/provider-signals';
import type { ProviderSignalEvaluator } from '../runtime/provider-state-engine';

const composerSelectors = ['[aria-label="Chat with ChatGPT"]', '[contenteditable="true"]'];
const assistantSelector = '[data-message-author-role="assistant"]';
const newConversationSelectors = [
  'a[href="/"], a[href="/new"]',
  'button[aria-label*="New chat"]',
  'button[aria-label*="New conversation"]'
];

const chatgptSignalEvaluator: ProviderSignalEvaluator = {
  evaluate: (candidates, observedAt) => {
    const stopVisible = Boolean(
      document.querySelector('button[aria-label*="Stop"], [data-testid="stop-button"]')
    );
    const inputEnabled = Boolean(first<HTMLElement>(composerSelectors));
    const error = pageAlertText();
    return observationFromCandidates(
      candidates,
      {
        generation_active: stopVisible,
        stop_visible: stopVisible,
        idle_visible: !stopVisible,
        input_enabled: inputEnabled,
        error_visible: Boolean(error)
      },
      error,
      stopVisible ? 'stop-control' : 'idle-control',
      observedAt
    );
  }
};

export const chatgptAdapter: ChatProviderAdapter = {
  id: 'chatgpt-com',
  matchesPage: () => location.hostname === 'chatgpt.com' || location.hostname === 'chat.openai.com',
  canHandle: () => Boolean(first<HTMLElement>(composerSelectors)),
  signalEvaluator: chatgptSignalEvaluator,
  getDebugChecks: () => [
    debugCheck('composer', 'Composer', composerSelectors),
    {
      id: 'submit',
      label: 'Submit',
      present: true,
      detail: 'Uses Enter to submit',
      selector: 'Enter'
    },
    debugCheck('assistant-response', 'Assistant response', [assistantSelector]),
    debugCheck('new-chat', 'New conversation', newConversationSelectors)
  ],
  findComposer: () => first<HTMLElement>(composerSelectors),
  setComposerText: async (text) => {
    const composer = chatgptAdapter.findComposer();
    if (!composer) throw new Error('ChatGPT composer was not found');
    setTextValue(composer, text);
  },
  findSubmitButton: () => null,
  submit: async () => {
    const composer = chatgptAdapter.findComposer();
    if (!composer) throw new Error('ChatGPT composer was not found');
    composer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    );
  },
  stopGeneration: async () => {
    document
      .querySelector<HTMLButtonElement>('button[aria-label*="Stop"], [data-testid="stop-button"]')
      ?.click();
  },
  startNewConversation: async () => {
    const control = first<HTMLElement>(newConversationSelectors);
    if (control) {
      control.click();
      return;
    }
    location.assign('https://chatgpt.com/');
  },
  getAssistantCandidates: () =>
    Array.from(document.querySelectorAll<HTMLElement>(assistantSelector)).map((element, index) => ({
      key:
        element.getAttribute('data-message-id') ||
        element.getAttribute('data-testid') ||
        `chatgpt-${index}`,
      text: textFrom(element),
      visible: isVisible(element)
    }))
};
