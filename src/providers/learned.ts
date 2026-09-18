import type { BrowserProviderProfile, ShadowLocator } from '../mcplab/types';
import type { ChatProviderAdapter } from './types';
import type { ResponseCandidate } from '../runtime/candidate-selection';
import { isVisible, setTextValue, textFrom } from './dom';
import { pageAlertText } from './adapter-helpers';
import { controlLabel, isGenerationControlLabel } from './control-labels';

function findFallbackSubmit(includeDisabled = false): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"]')).find((element) => {
      if (!isVisible(element)) return false;
      if (!includeDisabled && (element as HTMLButtonElement).disabled) return false;
      const label = `${controlLabel(element)} ${element.getAttribute('data-testid') ?? ''}`;
      return /\b(send|submit|ask|run)\b/.test(label) && !isGenerationControlLabel(label);
    }) ?? null
  );
}

function findStopControl(): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"]')).find((element) => {
      if (!isVisible(element)) return false;
      return isGenerationControlLabel(controlLabel(element));
    }) ?? null
  );
}

function composerValue(element: HTMLElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
    return element.value;
  return element.textContent ?? '';
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
    roots = matches.flatMap((match) =>
      match instanceof HTMLElement && match.shadowRoot
        ? [match.shadowRoot]
        : rootsFor(match.ownerDocument)
    );
  }
  return [];
}

function newConversationLocators(profile: BrowserProviderProfile): ShadowLocator[] {
  const configured = profile.newConversation;
  if (!configured || configured.action !== 'click') return [];
  const locators = [configured.locator, ...(configured.locators ?? [])].filter(
    (locator): locator is ShadowLocator => Boolean(locator)
  );
  return locators.filter(
    (locator, index) =>
      locators.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(locator)) ===
      index
  );
}

function clickableTarget(element: HTMLElement): HTMLElement {
  if (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLAnchorElement ||
    element.getAttribute('role') === 'button'
  )
    return element;
  const controls = Array.from(element.querySelectorAll<HTMLElement>('button,a,[role="button"]'));
  return controls.find(isVisible) ?? controls[0] ?? element;
}

export function createLearnedAdapter(profile: BrowserProviderProfile): ChatProviderAdapter {
  let lastCompletion:
    | {
        generationObserved: boolean;
        responseObserved: boolean;
        completionSignal?: string;
        elapsedMs: number;
        stableForMs: number;
      }
    | undefined;
  const findComposer = () =>
    (findPath(profile.composer.locator)[0] as HTMLElement | undefined) ?? null;
  const candidates = () =>
    findPath(profile.assistantMessages.locator, true).map((element, index) => ({
      key: `${profile.id}-${index}-${element.textContent?.length ?? 0}`,
      text: textFrom(
        profile.assistantMessages.textLocator
          ? (findPath(profile.assistantMessages.textLocator)[0] ?? element)
          : element
      ),
      visible: isVisible(element as HTMLElement)
    }));
  return {
    id: profile.id,
    requiresGenerationSignal: true,
    recordCompletion: (details) => {
      lastCompletion = details;
    },
    matchesPage: () => profile.match.origins.includes(location.origin),
    canHandle: () => Boolean(findComposer()),
    findComposer,
    setComposerText: async (text) => {
      const composer = findComposer();
      if (!composer) throw new Error(`${profile.name} composer was not found`);
      setTextValue(composer, text);
    },
    findSubmitButton: () =>
      (profile.submit.locator
        ? (findPath(profile.submit.locator)[0] as HTMLButtonElement | undefined)
        : null) ?? null,
    submit: async () => {
      if (profile.submit.action === 'click') {
        const button = profile.submit.locator
          ? (findPath(profile.submit.locator)[0] as HTMLElement | undefined)
          : undefined;
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
      composer.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      );
      composer.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true })
      );
    },
    stopGeneration: async () => {
      findStopControl()?.click();
    },
    startNewConversation: profile.newConversation
      ? async () => {
          if (profile.newConversation?.action === 'navigate') {
            if (!profile.newConversation.url)
              throw new Error(`${profile.name} new conversation URL is missing`);
            location.assign(profile.newConversation.url);
            return;
          }
          const button = newConversationLocators(profile)
            .map((locator) => findPath(locator)[0] as HTMLElement | undefined)
            .filter((element): element is HTMLElement => Boolean(element))
            .map(clickableTarget)
            .find(Boolean);
          if (!button) throw new Error(`${profile.name} new conversation control was not found`);
          const initialComposer = findComposer();
          const beforeComposer = initialComposer ? composerValue(initialComposer) : '';
          const composerStartedWithText = Boolean(beforeComposer.trim());
          const beforeMessageCount = candidates().length;
          const beforeUrl = location.href;
          button.click();
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline) {
            const composer = findComposer();
            const messageCount = candidates().length;
            const changedConversation =
              (composerStartedWithText && Boolean(composer && !composerValue(composer).trim())) ||
              messageCount < beforeMessageCount ||
              location.href !== beforeUrl;
            if (composer && !composerValue(composer).trim() && changedConversation) return;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error(`${profile.name} new conversation did not become ready`);
        }
      : undefined,
    getAssistantCandidates: candidates,
    getResponseState: (items: ResponseCandidate[]) => {
      const submitControl = profile.submit.locator
        ? (findPath(profile.submit.locator)[0] as HTMLElement | undefined)
        : findFallbackSubmit(true);
      const generating = profile.completion.generatingLocator
        ? Boolean(findPath(profile.completion.generatingLocator)[0])
        : Boolean(
            findStopControl() ||
            (submitControl instanceof HTMLButtonElement && submitControl.disabled)
          );
      const idle = profile.completion.idleLocator
        ? Boolean(findPath(profile.completion.idleLocator)[0])
        : !generating && Boolean(submitControl || findComposer());
      const error = pageAlertText();
      return {
        text: items.at(-1)?.text ?? '',
        isGenerating: generating,
        isIdle: idle,
        generationObserved: generating,
        completionSignal: profile.completion.idleLocator
          ? idle
            ? 'idle-locator'
            : generating
              ? 'generating-locator'
              : undefined
          : generating
            ? 'generation-control'
            : idle
              ? 'fallback-idle'
              : undefined,
        error
      };
    },
    getDebugChecks: () => [
      {
        id: 'composer',
        label: 'Composer',
        present: Boolean(findComposer()),
        detail: profile.learned.confidence.composer ?? 'Learned profile'
      },
      {
        id: 'assistant-response',
        label: 'Assistant response',
        present: candidates().length > 0,
        detail: profile.learned.confidence.assistantMessages ?? 'Learned profile'
      },
      {
        id: 'completion',
        label: 'Completion signal',
        present: Boolean(lastCompletion),
        detail: lastCompletion
          ? `${lastCompletion.completionSignal ?? 'idle'}; generationObserved=${lastCompletion.generationObserved}; responseObserved=${lastCompletion.responseObserved}; stable=${lastCompletion.stableForMs}ms`
          : 'No completed response captured yet.'
      },
      ...(profile.newConversation
        ? [
            {
              id: 'new-chat',
              label: 'New conversation',
              present:
                profile.newConversation.action === 'navigate'
                  ? Boolean(profile.newConversation.url)
                  : newConversationLocators(profile).some((locator) => Boolean(findPath(locator)[0])),
              detail:
                profile.newConversation.action === 'navigate'
                  ? 'Uses the learned navigation URL'
                  : 'Uses the learned page control'
            }
          ]
        : [])
    ]
  };
}
