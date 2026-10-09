import type { BrowserProviderProfile, ShadowLocator } from '../mcplab/types';
import type { ChatProviderAdapter } from './types';
import { composerValue, isVisible, setTextValue, textFrom } from './dom';
import { pageAlertText, visibleResponseCount, waitForNewConversation } from './adapter-helpers';
import { controlLabel, isGenerationControlLabel } from './control-labels';
import { stableTurnIdentity } from './turn-identity';
import { queryShadowLocator } from './shadow-locator';
import {
  resolveNewConversationControl,
  newConversationTargetUrl
} from './new-conversation-control';
import { observationFromCandidates } from '../runtime/provider-signals';
import type { ProviderSignalEvaluator } from '../runtime/provider-state-engine';

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

function findPath(locator: ShadowLocator, all = false): Element[] {
  const matches = queryShadowLocator(locator);
  return all ? matches : matches.slice(0, 1);
}

function findTextWithin(candidate: Element, locator: ShadowLocator): Element | null {
  let roots: Array<Element | ShadowRoot> = [candidate];
  for (const [index, selector] of locator.segments.entries()) {
    const matches = roots.flatMap((root) => Array.from(root.querySelectorAll(selector)));
    if (index === locator.segments.length - 1) return matches[0] ?? null;
    roots = matches.flatMap((match) => (match.shadowRoot ? [match.shadowRoot] : []));
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

export function createMcplabAdapter(profile: BrowserProviderProfile): ChatProviderAdapter {
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
  const findNewConversationControl = () =>
    newConversationLocators(profile)
      .flatMap((locator) => findPath(locator, true) as HTMLElement[])
      .map(resolveNewConversationControl)
      .find((element): element is HTMLElement => Boolean(element));
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
  const signalEvaluator: ProviderSignalEvaluator = {
    evaluate: (items, observedAt) => {
      const submitControl = profile.submit.locator
        ? (findPath(profile.submit.locator)[0] as HTMLElement | undefined)
        : findFallbackSubmit(true);
      const stopControl = findStopControl();
      const configuredGenerating = profile.completion.generatingLocator
        ? findPath(profile.completion.generatingLocator, true).some((element) =>
            isVisible(element as HTMLElement)
          )
        : undefined;
      const generating =
        configuredGenerating ??
        Boolean(
          stopControl || (submitControl instanceof HTMLButtonElement && submitControl.disabled)
        );
      const stopVisible = configuredGenerating ?? Boolean(stopControl);
      const idle = profile.completion.idleLocator
        ? findPath(profile.completion.idleLocator, true).some((element) =>
            isVisible(element as HTMLElement)
          )
        : !generating && Boolean(submitControl || findComposer());
      const working = profile.completion.workingLocator
        ? findPath(profile.completion.workingLocator).some((element) =>
            isVisible(element as HTMLElement)
          )
        : false;
      const error = pageAlertText();
      return observationFromCandidates(
        items,
        {
          generation_active: generating,
          stop_visible: stopVisible,
          working_visible: working,
          assistant_busy: working,
          idle_visible: idle,
          input_enabled: Boolean(findComposer()),
          error_visible: Boolean(error)
        },
        error,
        profile.completion.idleLocator
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
        observedAt
      );
    }
  };
  return {
    id: profile.id,
    completionStabilityMs: profile.completion.stabilityMs,
    requiresGenerationSignal: true,
    signalEvaluator,
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
          const initialComposer = findComposer();
          const beforeComposer = initialComposer ? composerValue(initialComposer) : '';
          const beforeMessageCount = visibleResponseCount(candidates());
          if (initialComposer && !beforeComposer.trim() && beforeMessageCount === 0) return;
          const button = findNewConversationControl();
          if (!button) throw new Error(`${profile.name} new conversation control was not found`);
          await waitForNewConversation({
            findComposer,
            messageCount: () => visibleResponseCount(candidates()),
            start: () => button.click(),
            providerName: profile.name,
            confirmation: profile.newConversation?.confirmation
          });
        }
      : undefined,
    getNewConversationUrl: () => {
      if (profile.newConversation?.action === 'navigate') return profile.newConversation.url;
      const control = findNewConversationControl();
      return control ? newConversationTargetUrl(control) : undefined;
    },
    getAssistantCandidates: candidates,
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
