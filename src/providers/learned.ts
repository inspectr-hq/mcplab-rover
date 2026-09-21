import type { BrowserProviderProfile, ShadowLocator } from '../mcplab/types';
import type { ChatProviderAdapter } from './types';
import type { ResponseCandidate } from '../runtime/candidate-selection';
import { isVisible, setTextValue, textFrom } from './dom';
import { pageAlertText } from './adapter-helpers';
import { controlLabel, isGenerationControlLabel } from './control-labels';
import { stableTurnIdentity } from './turn-identity';

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

function findTextWithin(candidate: Element, locator: ShadowLocator): Element | null {
  let roots: Array<Element | ShadowRoot> = [candidate];
  for (const [index, selector] of locator.segments.entries()) {
    const matches = roots.flatMap((root) => Array.from(root.querySelectorAll(selector)));
    if (index === locator.segments.length - 1) return matches[0] ?? null;
    roots = matches.flatMap((match) => match.shadowRoot ? [match.shadowRoot] : []);
  }
  return null;
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
  const anonymousTurnKeys = new WeakMap<Element, string>();
  let nextAnonymousTurnKey = 0;
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
  const turnIdentity = (element: Element) => {
    const stable = stableTurnIdentity(element);
    if (stable) return { key: `${profile.id}:${stable}`, ephemeralIdentity: false };
    let key = anonymousTurnKeys.get(element);
    if (!key) {
      key = `${profile.id}:anonymous:${++nextAnonymousTurnKey}`;
      anonymousTurnKeys.set(element, key);
    }
    return { key, ephemeralIdentity: true };
  };
  const candidates = () =>
    findPath(profile.assistantMessages.locator, true).map((element) => ({
      ...turnIdentity(element),
      text: textFrom(
        profile.assistantMessages.textLocator
          ? (findTextWithin(element, profile.assistantMessages.textLocator) ?? element)
          : element
      ),
      visible: isVisible(element as HTMLElement)
    }));
  return {
    id: profile.id,
    completionStabilityMs: profile.completion.stabilityMs,
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
            .flatMap((locator) => findPath(locator, true) as HTMLElement[])
            .filter((element) => isVisible(element))
            .find((element) => {
              const target = clickableTarget(element);
              const label = `${controlLabel(element)} ${controlLabel(target)} ${element.getAttribute('data-test') ?? ''} ${element.getAttribute('data-testid') ?? ''} ${element.getAttribute('trackingtest') ?? ''}`;
              return /new[\s_-]*(chat|conversation)|new[\s_-]*thread|start[\s_-]*(a[\s_-]*)?new/.test(label);
            });
          if (!button) throw new Error(`${profile.name} new conversation control was not found`);
          const initialComposer = findComposer();
          const beforeComposer = initialComposer ? composerValue(initialComposer) : '';
          const composerStartedWithText = Boolean(beforeComposer.trim());
          const beforeMessageCount = candidates().length;
          const beforeUrl = location.href;
          let lastMutationAt = 0;
          const mutationObserver = new MutationObserver(() => {
            lastMutationAt = Date.now();
          });
          mutationObserver.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true
          });
          clickableTarget(button).click();
          try {
            const deadline = Date.now() + 15_000;
            while (Date.now() < deadline) {
              const composer = findComposer();
              const messageCount = candidates().length;
              const changedConversation =
                (composerStartedWithText && Boolean(composer && !composerValue(composer).trim())) ||
                messageCount < beforeMessageCount ||
                location.href !== beforeUrl;
              const meaningfulContextChange =
                messageCount < beforeMessageCount || location.href !== beforeUrl;
              const settledMutation = lastMutationAt > 0 && Date.now() - lastMutationAt >= 100;
              if (
                composer &&
                !composerValue(composer).trim() &&
                (profile.newConversation?.confirmation === 'context-change'
                  ? meaningfulContextChange
                  : changedConversation || settledMutation)
              )
                return;
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
          } finally {
            mutationObserver.disconnect();
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
        ? findPath(profile.completion.generatingLocator, true).some((element) =>
            isVisible(element as HTMLElement)
          )
        : Boolean(
            findStopControl() ||
            (submitControl instanceof HTMLButtonElement && submitControl.disabled)
          );
      const idle = profile.completion.idleLocator
        ? findPath(profile.completion.idleLocator, true).some((element) =>
            isVisible(element as HTMLElement)
          )
        : !generating && Boolean(submitControl || findComposer());
      const working = profile.completion.workingLocator
        ? findPath(profile.completion.workingLocator).some((element) => isVisible(element as HTMLElement))
        : false;
      const error = pageAlertText();
      return {
        text: items.at(-1)?.text ?? '',
        isGenerating: generating,
        isIdle: idle,
        isWorking: working,
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
                  : newConversationLocators(profile).some((locator) =>
                      Boolean(findPath(locator)[0])
                    ),
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
