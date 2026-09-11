import type { BrowserProviderProfile, ShadowLocator } from '../mcplab/types';
import type { ChatProviderAdapter } from './types';
import type { ResponseCandidate } from '../runtime/candidate-selection';
import { isVisible, setTextValue, textFrom } from './dom';

function findFallbackSubmit(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"]')).find((element) => {
    if (!isVisible(element) || (element as HTMLButtonElement).disabled) return false;
    const label = `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''} ${element.getAttribute('data-testid') ?? ''} ${element.textContent ?? ''}`.toLowerCase();
    return /\b(send|submit|ask|run)\b/.test(label) && !/stop|cancel/.test(label);
  }) ?? null;
}

function rootsFor(root: Document | ShadowRoot): Array<Document | ShadowRoot> {
  const result: Array<Document | ShadowRoot> = [root];
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (element.shadowRoot) result.push(element.shadowRoot);
  }
  return result;
}

function findPath(locator: ShadowLocator, all = false): Element[] {
  let roots: Array<Document | ShadowRoot> = [document];
  for (const [index, selector] of locator.segments.entries()) {
    const matches = roots.flatMap((root) => Array.from(root.querySelectorAll(selector)));
    if (index === locator.segments.length - 1) return all ? matches : matches.slice(0, 1);
    roots = matches.flatMap((match) => match instanceof HTMLElement && match.shadowRoot ? [match.shadowRoot] : rootsFor(match.ownerDocument));
  }
  return [];
}

export function createLearnedAdapter(profile: BrowserProviderProfile): ChatProviderAdapter {
  const findComposer = () => findPath(profile.composer.locator)[0] as HTMLElement | undefined ?? null;
  const candidates = () => findPath(profile.assistantMessages.locator, true).map((element, index) => ({
    key: `${profile.id}-${index}-${element.textContent?.length ?? 0}`,
    text: textFrom(profile.assistantMessages.textLocator ? (findPath(profile.assistantMessages.textLocator)[0] ?? element) : element),
    visible: isVisible(element as HTMLElement)
  }));
  return {
    id: profile.id,
    matchesPage: () => profile.match.origins.includes(location.origin),
    canHandle: () => Boolean(findComposer()),
    findComposer,
    setComposerText: async (text) => {
      const composer = findComposer();
      if (!composer) throw new Error(`${profile.name} composer was not found`);
      setTextValue(composer, text);
    },
    findSubmitButton: () => (profile.submit.locator ? findPath(profile.submit.locator)[0] as HTMLButtonElement | undefined : null) ?? null,
    submit: async () => {
      if (profile.submit.action === 'click') {
        const button = profile.submit.locator ? findPath(profile.submit.locator)[0] as HTMLElement | undefined : undefined;
        if (!button) throw new Error(`${profile.name} submit control was not found`);
        button.click();
        return;
      }
      const composer = findComposer();
      if (!composer) throw new Error(`${profile.name} composer was not found`);
      const button = findFallbackSubmit();
      if (button) {
        button.click();
        return;
      }
      composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      composer.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    },
    startNewConversation: profile.newConversation ? async () => {
      if (profile.newConversation?.action === 'navigate') {
        if (!profile.newConversation.url) throw new Error(`${profile.name} new conversation URL is missing`);
        location.assign(profile.newConversation.url);
        return;
      }
      const button = profile.newConversation?.locator ? findPath(profile.newConversation.locator)[0] as HTMLElement | undefined : undefined;
      if (!button) throw new Error(`${profile.name} new conversation control was not found`);
      button.click();
    } : undefined,
    getAssistantCandidates: candidates,
    getResponseState: (items: ResponseCandidate[]) => {
      const generating = profile.completion.generatingLocator ? Boolean(findPath(profile.completion.generatingLocator)[0]) : false;
      const idle = profile.completion.idleLocator ? Boolean(findPath(profile.completion.idleLocator)[0]) : !generating;
      return { text: items.at(-1)?.text ?? '', isGenerating: generating, isIdle: idle, error: null };
    },
    getDebugChecks: () => [
      { id: 'composer', label: 'Composer', present: Boolean(findComposer()), detail: profile.learned.confidence.composer ?? 'Learned profile' },
      { id: 'assistant-response', label: 'Assistant response', present: candidates().length > 0, detail: profile.learned.confidence.assistantMessages ?? 'Learned profile' }
    ]
  };
}
