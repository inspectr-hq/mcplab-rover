import type { ChatProviderAdapter } from './types';
import { composerValue, isVisible, setTextValue, textFrom } from './dom';
import {
  debugCheck,
  first,
  pageAlertText,
  visibleResponseCount,
  waitForNewConversation
} from './adapter-helpers';
import type { ResponseCandidate } from '../runtime/candidate-selection';
import { observationFromCandidates } from '../runtime/provider-signals';
import type { ProviderSignalEvaluator } from '../runtime/provider-state-engine';

const composerSelectors = [
  '[contenteditable="true"][aria-label="Ask ChatGPT"]',
  '[aria-label="Chat with ChatGPT"]',
  '[contenteditable="true"]'
];
const assistantSelector =
  '[data-message-author-role="assistant"], [data-markdown-text-style="assistant-message"]';
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
    const initialComposer = chatgptAdapter.findComposer();
    const beforeMessageCount = visibleResponseCount(chatgptAdapter.getAssistantCandidates());
    if (
      initialComposer &&
      !composerValue(initialComposer).trim() &&
      beforeMessageCount === 0 &&
      !location.pathname.startsWith('/c/')
    )
      return;
    const control = first<HTMLElement>(newConversationSelectors);
    if (control) {
      await waitForNewConversation({
        findComposer: chatgptAdapter.findComposer,
        messageCount: () => visibleResponseCount(chatgptAdapter.getAssistantCandidates()),
        start: () => control.click(),
        providerName: 'ChatGPT',
        confirmation: 'empty-chat'
      });
      return;
    }
    location.assign('https://chatgpt.com/');
  },
  getAssistantCandidates: () => {
    const turns = new Map<string, ResponseCandidate[]>();
    Array.from(document.querySelectorAll<HTMLElement>(assistantSelector))
      .filter((element) => !element.querySelector(assistantSelector))
      .forEach((element, index) => {
        const key =
          element.closest('[data-message-id]')?.getAttribute('data-message-id') ||
          element
            .closest('[data-chatgpt-selection-message-id]')
            ?.getAttribute('data-chatgpt-selection-message-id') ||
          element.closest('[data-turn-key]')?.getAttribute('data-turn-key') ||
          `chatgpt-${index}`;
        const blocks = turns.get(key) ?? [];
        blocks.push({ key, text: textFrom(element), visible: isVisible(element) });
        turns.set(key, blocks);
      });
    return Array.from(turns, ([key, blocks]) => {
      const visible = blocks.filter((block) => block.visible);
      return {
        key,
        text: (visible.length ? visible : blocks).map((block) => block.text).join('\n\n'),
        visible: visible.length > 0
      };
    });
  }
};
