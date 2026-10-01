import type { ChatProviderAdapter } from './types';
import { isVisible, textFrom } from './dom';
import { debugCheck, first, pageAlertText } from './adapter-helpers';
import { observationFromCandidates } from '../runtime/provider-signals';
import type { ProviderSignalEvaluator } from '../runtime/provider-state-engine';
import { stableTurnIdentity } from './turn-identity';

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
const anonymousTurnKeys = new WeakMap<Element, string>();
let nextAnonymousTurnKey = 0;

function turnIdentity(element: Element): { key: string; ephemeralIdentity: boolean } {
  const stable = stableTurnIdentity(element);
  if (stable) return { key: `claude:${stable}`, ephemeralIdentity: false };
  let key = anonymousTurnKeys.get(element);
  if (!key) {
    key = `claude:anonymous:${++nextAnonymousTurnKey}`;
    anonymousTurnKeys.set(element, key);
  }
  return { key, ephemeralIdentity: true };
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

const claudeSignalEvaluator: ProviderSignalEvaluator = {
  evaluate: (candidates, observedAt) => {
    const stop = document.querySelector('[aria-label*="Stop"], button[data-is-streaming="true"]');
    const submit = first<HTMLButtonElement>(submitSelectors);
    const assistantBusy = Boolean(document.querySelector('[data-is-streaming="true"]'));
    const generationActive = Boolean(stop || assistantBusy);
    const inputEnabled = Boolean(submit && !submit.disabled);
    const completedContainer = Boolean(document.querySelector('[data-is-streaming="false"]'));
    const idle = !generationActive && (completedContainer || inputEnabled);
    const error = pageAlertText();
    return observationFromCandidates(
      candidates,
      {
        generation_active: generationActive,
        stop_visible: Boolean(stop),
        assistant_busy: assistantBusy,
        idle_visible: idle,
        input_enabled: inputEnabled,
        error_visible: Boolean(error)
      },
      error,
      idle ? 'idle-control' : generationActive ? 'generation-control' : undefined,
      observedAt
    );
  }
};

export const claudeAdapter: ChatProviderAdapter = {
  id: 'claude',
  matchesPage: () => location.hostname === 'claude.ai',
  canHandle: () => location.hostname === 'claude.ai',
  signalEvaluator: claudeSignalEvaluator,
  getDebugChecks: () => [
    debugCheck('composer', 'Composer', composerSelectors),
    debugCheck('submit', 'Submit button', submitSelectors),
    debugCheck('assistant-response', 'Assistant response', assistantSelectors)
  ],
  findComposer: () => first<HTMLElement>(composerSelectors),
  setComposerText: async (text) => {
    const composer = claudeAdapter.findComposer();
    if (!composer) throw new Error('Claude composer was not found');
    composer.focus();
    const paragraph = composer.querySelector('p') || document.createElement('p');
    paragraph.textContent = text;
    if (!paragraph.parentElement) composer.replaceChildren(paragraph);
    composer.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text })
    );
    composer.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
    );
    composer.dispatchEvent(new Event('change', { bubbles: true }));
  },
  findSubmitButton: () => first<HTMLButtonElement>(submitSelectors),
  submit: async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const button = await waitForEnabledButton();
    button.click();
  },
  stopGeneration: async () => {
    const stop = document.querySelector<HTMLButtonElement>(
      '[aria-label*="Stop"], button[data-is-streaming="true"]'
    );
    stop?.click();
  },
  getAssistantCandidates: () => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(assistantSelectors.join(','))
    );
    return elements.map((element) => ({
      ...turnIdentity(element),
      text: textFrom(element),
      visible: isVisible(element)
    }));
  }
};
