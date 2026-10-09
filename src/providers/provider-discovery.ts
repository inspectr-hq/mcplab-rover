import type {
  BrowserProviderDiscoveryDraft,
  BrowserProviderDiscoveryProgress,
  BrowserProviderDiscoveryTrace,
  BrowserProviderDiscoveryTraceEvent
} from '../contracts';
import type { BrowserProviderProfile, ShadowLocator } from '../mcplab/types';
import {
  hasAssistantMarker,
  scoreAssistantCandidate,
  selectAssistantCandidate,
  type ChatCandidateDescriptor
} from './candidate-descriptor';
import { replayProviderProfile } from './discovery-replay';
import { controlLabel, isGenerationControlLabel } from './control-labels';
import { stableTurnIdentity } from './turn-identity';
import { composerValue, isVisible } from './dom';
import { queryShadowLocator } from './shadow-locator';
import {
  NEW_CONVERSATION_WINDOW_MS,
  NEW_CONVERSATION_STABILITY_MS,
  newConversationCapability
} from './new-conversation-evidence';
import {
  NEW_CONVERSATION_CANDIDATES,
  newConversationLabelSource,
  newConversationTargetUrl,
  resolveNewConversationControl
} from './new-conversation-control';

const DISCOVERY_LOG = '[MCPLab Rover][provider-discovery]';
const COMPLETION_STABILITY_MS = 2500;

function discoveryLog(message: string, details?: unknown): void {
  if (details === undefined) console.info(`${DISCOVERY_LOG} ${message}`);
  else console.info(`${DISCOVERY_LOG} ${message}`, details);
}

function visible(element: Element): boolean {
  const node = element as HTMLElement;
  const rect = node.getBoundingClientRect();
  return (
    getComputedStyle(node).display !== 'none' &&
    getComputedStyle(node).visibility !== 'hidden' &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function assistantClassSelector(element: Element): string | undefined {
  const className = Array.from(element.classList).find((value) =>
    /(?:^|[-_])assistant(?:$|[-_])/i.test(value)
  );
  return className ? `.${CSS.escape(className)}` : undefined;
}

function selectorAttributeValue(element: Element, attribute: string): string | undefined {
  const value = element.getAttribute(attribute)?.trim();
  if (!value || /^\[object\s+[^\]]+\]$/i.test(value)) return undefined;
  return value;
}

function selector(element: Element): string {
  const html = element as HTMLElement;
  const authorRole = selectorAttributeValue(html, 'data-message-author-role');
  if (authorRole) return `[data-message-author-role="${CSS.escape(authorRole)}"]`;
  const assistantClass = assistantClassSelector(element);
  if (assistantClass) return assistantClass;
  for (const attribute of ['data-testid', 'data-test', 'aria-label', 'title', 'name']) {
    const value = selectorAttributeValue(html, attribute);
    if (value) return `[${attribute}="${CSS.escape(value)}"]`;
  }
  if (element.getAttribute('role') === 'article') return '[role="article"]';
  const id = selectorAttributeValue(html, 'id');
  if (id) return `[id="${CSS.escape(id)}"]`;
  if (element.tagName === 'TEXTAREA') return 'textarea';
  if (element.tagName === 'INPUT') return 'input';
  if (html.isContentEditable) return '[contenteditable="true"]';
  return element.tagName.toLowerCase();
}

function selectorCandidates(element: Element): string[] {
  const result = [selector(element)];
  const assistantClass = assistantClassSelector(element);
  if (assistantClass) result.push(assistantClass);
  for (const attribute of [
    'data-message-author-role',
    'data-testid',
    'data-test',
    'aria-label',
    'title',
    'name',
    'id'
  ]) {
    const value = selectorAttributeValue(element, attribute);
    if (value) result.push(`[${attribute}="${CSS.escape(value)}"]`);
  }
  if (element.getAttribute('role'))
    result.push(`[role="${CSS.escape(element.getAttribute('role')!)}"]`);
  if (element.getAttribute('aria-busy') === 'true')
    result.push(`${element.tagName.toLowerCase()}[aria-busy="true"]`);
  result.push(element.tagName.toLowerCase());
  return [...new Set(result)];
}

function locator(element: Element): ShadowLocator {
  const segments = [selector(element)];
  let current: Node | null = element.parentNode;
  while (current) {
    if (current instanceof ShadowRoot) {
      const host = current.host;
      segments.unshift(selector(host));
      current = host.parentNode;
      continue;
    }
    current = current.parentNode;
  }
  return { segments };
}

function roots(root: Document | ShadowRoot): Array<Document | ShadowRoot> {
  const result: Array<Document | ShadowRoot> = [root];
  for (const host of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (host.shadowRoot) result.push(...roots(host.shadowRoot));
  }
  return result;
}

function allElements(selectorText: string): HTMLElement[] {
  return roots(document).flatMap((root) =>
    Array.from(root.querySelectorAll<HTMLElement>(selectorText))
  );
}

function findNewConversationControls(): HTMLElement[] {
  return [
    ...new Set(
      allElements(NEW_CONVERSATION_CANDIDATES)
        .map(resolveNewConversationControl)
        .filter((element): element is HTMLElement => Boolean(element))
    )
  ];
}

function clickedNewConversationControl(
  path: EventTarget[],
  controls: HTMLElement[]
): HTMLElement | undefined {
  for (const target of path) {
    if (!(target instanceof HTMLElement)) continue;
    const resolved = resolveNewConversationControl(target);
    if (resolved && controls.includes(resolved)) return resolved;
  }
  return undefined;
}

function uniqueControlSelector(element: HTMLElement): string {
  const root = element.getRootNode() as Document | ShadowRoot;
  const source = newConversationLabelSource(element);
  const scopeToSource = source !== element && source.getRootNode() === root;
  const chain: string[] = [];
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (!scopeToSource || current === source || current.contains(source)) {
      const unique = selectorCandidates(current).find((candidate) => {
        const matches = root.querySelectorAll(candidate);
        return matches.length === 1 && matches[0] === current;
      });
      if (unique) return [unique, ...chain].join(' > ');
    }
    const siblings = Array.from(current.parentElement?.children ?? root.children);
    const sameTag = siblings.filter((sibling) => sibling.tagName === current!.tagName);
    const segment = current.tagName.toLowerCase();
    chain.unshift(
      sameTag.length > 1 ? `${segment}:nth-of-type(${sameTag.indexOf(current) + 1})` : segment
    );
  }
  return chain.join(' > ');
}

function newConversationLocator(element: HTMLElement): ShadowLocator {
  const segments = [uniqueControlSelector(element)];
  let root = element.getRootNode();
  while (root instanceof ShadowRoot) {
    segments.unshift(uniqueControlSelector(root.host as HTMLElement));
    root = root.host.getRootNode();
  }
  return { segments };
}

function descriptor(element: HTMLElement, baselineTexts: Set<string>): ChatCandidateDescriptor {
  const ancestors: string[] = [];
  let parent = element.parentElement;
  while (parent && ancestors.length < 4) {
    if (parent.getAttribute('role')) ancestors.push(parent.getAttribute('role')!);
    parent = parent.parentElement;
  }
  return {
    tagName: element.tagName,
    role: element.getAttribute('role') ?? undefined,
    testId: element.getAttribute('data-testid') ?? undefined,
    dataTest: element.getAttribute('data-test') ?? undefined,
    authorRole: element.getAttribute('data-message-author-role') ?? undefined,
    ariaLabel: element.getAttribute('aria-label') ?? undefined,
    className: typeof element.className === 'string' ? element.className : undefined,
    text: element.innerText?.trim() ?? '',
    visible: visible(element),
    changed: !baselineTexts.has(element.innerText?.trim() ?? ''),
    ancestorRoles: ancestors
  };
}

function confidence(element: Element): 'high' | 'medium' | 'low' {
  return element.hasAttribute('data-message-author-role') ||
    element.hasAttribute('data-testid') ||
    element.hasAttribute('data-test') ||
    element.hasAttribute('aria-label')
    ? 'high'
    : element.id || element.getAttribute('role') === 'article'
      ? 'medium'
      : 'low';
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function controlState(): {
  visibleCount: number;
  disabledCount: number;
  generating: boolean;
  generatingControl: HTMLElement | null;
  idleControl: HTMLElement | null;
} {
  const controls = allElements('button,[role="button"]');
  const visibleControls = controls.filter((element) => visible(element));
  const generatingControl =
    visibleControls.find((element) => {
      return isGenerationControlLabel(controlLabel(element));
    }) ??
    visibleControls.find(
      (element) =>
        element instanceof HTMLButtonElement &&
        element.disabled &&
        /\b(send|submit|ask|run)\b/.test(controlLabel(element))
    ) ??
    null;
  const idleControl =
    visibleControls.find((element) => {
      const label =
        `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''} ${element.textContent ?? ''}`.toLowerCase();
      return (
        /\b(send|submit|ask|run)\b/.test(label) &&
        !(element instanceof HTMLButtonElement && element.disabled)
      );
    }) ?? null;
  return {
    visibleCount: visibleControls.length,
    disabledCount: visibleControls.filter(
      (element) => element instanceof HTMLButtonElement && element.disabled
    ).length,
    generating: Boolean(generatingControl),
    generatingControl,
    idleControl
  };
}

function validateLocator(value: ShadowLocator): {
  valid: boolean;
  matchCount: number;
  visible: boolean;
} {
  try {
    const matches = queryShadowLocator(value);
    return {
      valid: value.segments.length > 0,
      matchCount: matches.length,
      visible: matches.some((element) => visible(element))
    };
  } catch {
    return { valid: false, matchCount: 0, visible: false };
  }
}

function withFinalSelector(locatorValue: ShadowLocator, suffix: string): ShadowLocator {
  const segments = [...locatorValue.segments];
  const last = segments.length - 1;
  if (last >= 0) segments[last] = `${segments[last]}${suffix}`;
  return { segments };
}

function controlLocator(element: HTMLElement, state: 'generating' | 'idle'): ShadowLocator {
  const base = locator(element);
  if (isGenerationControlLabel(controlLabel(element))) return base;
  return withFinalSelector(base, state === 'generating' ? ':disabled' : ':not([disabled])');
}

function lifecycleSnapshot() {
  return allElements('*')
    .filter(
      (element) =>
        element instanceof HTMLButtonElement ||
        element.getAttribute('role') === 'button' ||
        element.isContentEditable ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element.getAttribute('data-message-author-role') === 'assistant' ||
        element.className.toString().includes('message')
    )
    .slice(-64)
    .map((element) => ({
      selector: selector(element),
      tagName: element.tagName,
      ...(element.getAttribute('role') ? { role: element.getAttribute('role')! } : {}),
      ...(element.getAttribute('aria-label')
        ? { ariaLabel: element.getAttribute('aria-label')! }
        : {}),
      ...(element.getAttribute('data-testid')
        ? { testId: element.getAttribute('data-testid')! }
        : {}),
      visible: visible(element),
      disabled: element instanceof HTMLButtonElement && element.disabled,
      textLength: (element.innerText ?? element.textContent ?? '').trim().length
    }));
}

export interface ProviderDiscoverySession {
  stop: () => void;
  /** Forces capture using whatever composer/response has been observed so far. */
  capture: () => boolean;
}

export function startProviderDiscovery(
  onDraft: (draft: BrowserProviderDiscoveryDraft) => void,
  onProgress?: (progress: BrowserProviderDiscoveryProgress) => void
): ProviderDiscoverySession {
  let composer: HTMLElement | null = null;
  let composerSnapshotRecorded = false;
  let submit: HTMLElement | null = null;
  let submissionTexts: Set<string> | null = null;
  let submissionElements: WeakSet<Element> | null = null;
  let submissionTurnIds: Set<string> | null = null;
  let submissionAssistantCount = 0;
  let assistant: HTMLElement | null = null;
  let submittedAt = 0;
  let emitted = false;
  let lastDraftReady = false;
  let lastDraftSignature = '';
  let lastDraft: BrowserProviderDiscoveryDraft | null = null;
  let pendingNewConversation: {
    controlLocator: ShadowLocator;
    controlSelectors: string[];
    destinationUrl?: string;
    beforeUrl: string;
    beforeAssistantCount: number;
    beforeAssistant: HTMLElement[];
    expiresAt: number;
    emptySince: number | null;
  } | null = null;
  let stopped = false;
  let observedGeneration = false;
  let observedIdle = false;
  let idleSince: number | null = null;
  let generatingLocator: ShadowLocator | undefined;
  let workingLocator: ShadowLocator | undefined;
  let lastWorkingElement: HTMLElement | null = null;
  let idleControl: HTMLElement | null = null;
  let lastCandidateCount = 0;
  let lastChangedCandidateCount = 0;
  let lastSelected: ChatCandidateDescriptor | undefined;
  let lastControls = controlState();
  let selectedStableSince: number | null = null;
  let selectedSignature = '';
  let lastProgressSignature = '';
  const reportProgress = () => {
    if (!onProgress) return;
    const progress: BrowserProviderDiscoveryProgress = {
      composerDetected: Boolean(composer),
      submitDetected: Boolean(submit),
      assistantDetected: Boolean(assistant),
      ...(assistant?.innerText?.trim()
        ? { assistantPreview: assistant.innerText.trim().slice(0, 160) }
        : {}),
      generatingObserved: observedGeneration,
      idleObserved: observedIdle,
      ...(lastDraft?.profile.newConversation
        ? {
            newConversationClicked: Boolean(
              pendingNewConversation && !pendingNewConversation.destinationUrl
            )
          }
        : {})
    };
    const signature = JSON.stringify(progress);
    if (signature === lastProgressSignature) return;
    lastProgressSignature = signature;
    onProgress(progress);
  };
  const trace: BrowserProviderDiscoveryTrace = {
    evidenceVersion: 1,
    observedGeneration: false,
    selectorValidation: {
      composer: { valid: false, matchCount: 0, visible: false },
      submit: { valid: false, matchCount: 0, visible: false },
      assistant: { valid: false, matchCount: 0, visible: false }
    },
    events: []
  };
  const startedAt = new Date().toISOString();
  const origin = location.origin;
  const baselineTexts = new Set(
    allElements('*')
      .map((element) => element.innerText?.trim())
      .filter((text): text is string => Boolean(text))
  );
  let lastScanSignature = '';
  const record = (
    phase: BrowserProviderDiscoveryTraceEvent['phase'],
    candidateCount: number,
    changedCandidateCount: number,
    controls: ReturnType<typeof controlState>,
    selected?: ChatCandidateDescriptor,
    selectedElement?: HTMLElement | null
  ) => {
    const evidenceFor = (element: HTMLElement, candidate?: ChatCandidateDescriptor) => {
      const currentAssistantCount = candidate
        ? allElements('*').filter((item) => {
            const value = descriptor(item, baselineTexts);
            return (
              value.visible &&
              Boolean(value.text.trim()) &&
              hasAssistantMarker(value) &&
              scoreAssistantCandidate(value) !== Number.NEGATIVE_INFINITY
            );
          }).length
        : 0;
      const identity = stableTurnIdentity(element);
      const attributes = {
        ...(element.getAttribute('role')
          ? { role: element.getAttribute('role')!.slice(0, 128) }
          : {}),
        ...(element.getAttribute('aria-label')
          ? { ariaLabel: element.getAttribute('aria-label')!.slice(0, 128) }
          : {}),
        ...(element.getAttribute('aria-busy')
          ? { ariaBusy: element.getAttribute('aria-busy')!.slice(0, 128) }
          : {}),
        ...(element.getAttribute('data-testid')
          ? { testId: element.getAttribute('data-testid')!.slice(0, 128) }
          : {}),
        ...(element.getAttribute('data-test')
          ? { dataTest: element.getAttribute('data-test')!.slice(0, 128) }
          : {}),
        ...(element.getAttribute('data-message-author-role')
          ? { authorRole: element.getAttribute('data-message-author-role')!.slice(0, 128) }
          : {})
      };
      const selectors = selectorCandidates(element);
      const selectorEvaluations = candidate
        ? Object.fromEntries(
            selectors.map((candidateSelector) => {
              const matches = allElements(candidateSelector);
              return [
                candidateSelector,
                {
                  matchCount: matches.length,
                  nonAssistantCount: matches.filter((match) => {
                    const matchDescriptor = descriptor(match, baselineTexts);
                    return (
                      !hasAssistantMarker(matchDescriptor) ||
                      scoreAssistantCandidate(matchDescriptor) === Number.NEGATIVE_INFINITY
                    );
                  }).length
                }
              ];
            })
          )
        : undefined;
      return {
        locator: locator(element),
        selectors,
        ...(selectorEvaluations ? { selectorEvaluations } : {}),
        visible: visible(element),
        textLength: (element.innerText ?? element.textContent ?? '').trim().length,
        ...(Object.keys(attributes).length ? { attributes } : {}),
        ...(candidate
          ? {
              changedFromBaseline: candidate.changed,
              changedAfterSubmission:
                submissionTexts !== null && !submissionTexts.has(candidate.text.trim()),
              absentAtSubmission:
                submissionElements !== null &&
                !submissionElements.has(element) &&
                (identity
                  ? !submissionTurnIds?.has(identity)
                  : currentAssistantCount > submissionAssistantCount),
              candidateScore: scoreAssistantCandidate(candidate)
            }
          : {})
      };
    };
    const selectedElements: NonNullable<BrowserProviderDiscoveryTraceEvent['selectedElements']> =
      {};
    if ((phase === 'baseline' || phase === 'submitted') && composer)
      selectedElements.composer = evidenceFor(composer);
    if (phase === 'submitted' && submit && submit !== composer)
      selectedElements.submit = evidenceFor(submit);
    if ((phase === 'candidate' || phase === 'final') && selectedElement)
      selectedElements.assistant = evidenceFor(selectedElement, selected);
    if (phase === 'generating' && controls.generatingControl)
      selectedElements.generating = evidenceFor(controls.generatingControl);
    if ((phase === 'working' || phase === 'final') && lastWorkingElement?.isConnected)
      selectedElements.working = evidenceFor(lastWorkingElement);
    if (phase === 'final' && controls.idleControl)
      selectedElements.idle = evidenceFor(controls.idleControl);
    trace.events.push({
      phase,
      at: new Date().toISOString(),
      candidateCount,
      changedCandidateCount,
      visibleControlCount: controls.visibleCount,
      disabledControlCount: controls.disabledCount,
      workingActive:
        Boolean(lastWorkingElement?.isConnected) &&
        lastWorkingElement?.getAttribute('aria-busy') === 'true',
      ...(selected
        ? {
            selectedCandidate: {
              tagName: selected.tagName,
              ...(selected.testId ? { testId: selected.testId } : {}),
              textLength: selected.text.length
            },
            textHash: shortHash(selected.text)
          }
        : {}),
      ...(Object.keys(selectedElements).length ? { selectedElements } : {}),
      snapshot: lifecycleSnapshot()
    });
    if (trace.events.length > 32) {
      const pinnedIndices = new Set(
        ['baseline', 'submitted', 'generating', 'working']
          .map((phase) => trace.events.findIndex((event) => event.phase === phase))
          .filter((index) => index >= 0)
      );
      const lifecycleEvents = trace.events.filter((_, index) => pinnedIndices.has(index));
      const recentEvents = trace.events
        .filter((_, index) => !pinnedIndices.has(index))
        .slice(-(32 - lifecycleEvents.length));
      trace.events = [...lifecycleEvents, ...recentEvents];
    }
  };
  record('baseline', 0, 0, controlState());
  discoveryLog('started', { origin, href: location.href, baselineTextCount: baselineTexts.size });
  const scan = () => {
    if (stopped) return;
    if (pendingNewConversation && lastDraft) {
      const pending = pendingNewConversation;
      if (Date.now() >= pending.expiresAt) {
        pendingNewConversation = null;
        reportProgress();
      } else {
        const assistantCount = queryShadowLocator(
          lastDraft.profile.assistantMessages.locator
        ).filter(isVisible).length;
        const currentComposer = queryShadowLocator(lastDraft.profile.composer.locator).find(
          isVisible
        );
        const previousResponseGone =
          pending.beforeAssistantCount > 0 &&
          assistantCount === 0 &&
          pending.beforeAssistant.every((element) => !element.isConnected || !isVisible(element));
        const emptyComposer = currentComposer && !composerValue(currentComposer).trim();
        if (!previousResponseGone || !emptyComposer) pending.emptySince = null;
        else pending.emptySince ??= Date.now();
        if (
          pending.emptySince !== null &&
          Date.now() - pending.emptySince >= NEW_CONVERSATION_STABILITY_MS
        ) {
          const currentUrl = new URL(location.href);
          currentUrl.hash = '';
          const beforeUrl = new URL(pending.beforeUrl);
          beforeUrl.hash = '';
          const signal =
            currentUrl.href !== beforeUrl.href ? 'url-changed' : 'assistant-count-reduced';
          discoveryLog('new conversation transition observed', {
            signal,
            beforeAssistantCount: pending.beforeAssistantCount,
            afterAssistantCount: assistantCount
          });
          const updatedTrace: BrowserProviderDiscoveryTrace = {
            ...trace,
            newConversationEvidence: {
              controlLocator: pending.controlLocator,
              controlSelectors: pending.controlSelectors,
              signal,
              beforeAssistantCount: pending.beforeAssistantCount,
              afterAssistantCount: assistantCount,
              composerEmpty: true,
              emptyChatStableMs: Date.now() - pending.emptySince,
              elapsedMs: Date.now() - (pending.expiresAt - NEW_CONVERSATION_WINDOW_MS),
              ...(pending.destinationUrl ? { destinationUrl: location.href } : {})
            }
          };
          // Save exactly the control whose click was observed, rather than the first label match.
          const profile: BrowserProviderProfile = {
            ...lastDraft.profile,
            newConversation: {
              action: pending.destinationUrl ? 'navigate' : 'click',
              ...(pending.destinationUrl ? { url: pending.destinationUrl } : {}),
              locator: pending.controlLocator,
              locators: [pending.controlLocator],
              confirmation: 'context-change'
            }
          };
          const replay = replayProviderProfile(profile, updatedTrace);
          lastDraftReady = replay.passed;
          lastDraft = {
            ...lastDraft,
            profile,
            trace: updatedTrace,
            readyToSave: replay.passed,
            validationReasons: replay.reasons,
            validationIssues: replay.issues,
            capabilities: lastDraft.capabilities.map((capability) =>
              capability.id === 'newConversation'
                ? newConversationCapability({
                    profile,
                    trace: updatedTrace,
                    validationIssues: replay.issues
                  })
                : capability
            )
          };
          pendingNewConversation = null;
          onDraft(lastDraft);
          reportProgress();
        }
      }
    }
    if (stopped || lastDraftReady || !submittedAt) return;
    const candidates = allElements('*')
      .filter(
        (element) =>
          !element.isContentEditable && element !== composer && !composer?.contains(element)
      )
      .filter((element) => element.children.length === 0 || (element.innerText?.length ?? 0) > 20)
      .map((element) => ({ element, descriptor: descriptor(element, baselineTexts) }));
    const selected = selectAssistantCandidate(candidates.map((candidate) => candidate.descriptor));
    const selectedElement = selected
      ? (candidates.find((candidate) => candidate.descriptor === selected)?.element ?? null)
      : null;
    const controls = controlState();
    const workingElement = selectedElement?.closest<HTMLElement>('[aria-busy="true"]') ?? null;
    if (workingElement) {
      lastWorkingElement = workingElement;
      workingLocator = withFinalSelector(locator(workingElement), '[aria-busy="true"]');
      record('working', candidates.length, 0, controls, selected ?? undefined);
    }
    if (controls.generating) {
      observedGeneration = true;
      trace.observedGeneration = true;
      generatingLocator = controls.generatingControl
        ? controlLocator(controls.generatingControl, 'generating')
        : undefined;
      record('generating', candidates.length, 0, controls, selected ?? undefined);
    }
    // Stop controls can disappear briefly between response stages. Require the same
    // sustained idle period used by the saved profile before claiming completion.
    if (controls.generating || workingElement || !selected) {
      idleSince = null;
      observedIdle = false;
    } else if (observedGeneration) {
      idleSince ??= Date.now();
      observedIdle = Date.now() - idleSince >= COMPLETION_STABILITY_MS;
    }
    idleControl = controls.idleControl;
    const topCandidates = candidates
      .map((candidate) => ({ element: candidate.element, descriptor: candidate.descriptor }))
      .filter((candidate) => candidate.descriptor.changed && candidate.descriptor.text.trim())
      .slice(-8)
      .map((candidate) => ({
        tag: candidate.descriptor.tagName,
        testId: candidate.descriptor.testId,
        role: candidate.descriptor.role,
        text: candidate.descriptor.text.slice(0, 120)
      }));
    lastCandidateCount = candidates.length;
    lastChangedCandidateCount = topCandidates.length;
    lastSelected = selected ?? undefined;
    lastControls = controls;
    const scanSignature = `${candidates.length}:${selected?.testId ?? selected?.tagName ?? 'none'}:${Boolean(workingElement)}:${topCandidates.map((candidate) => `${candidate.testId ?? candidate.tag}:${candidate.text}`).join('|')}`;
    // Stability follows the complete selected answer, not truncated debug previews or
    // unrelated DOM candidate counts that may change while the answer remains idle.
    const responseSignature = JSON.stringify([
      selectedElement ? locator(selectedElement).segments : null,
      selected?.text,
      Boolean(workingElement)
    ]);
    if (responseSignature !== selectedSignature) {
      selectedSignature = responseSignature;
      selectedStableSince = selected ? Date.now() : null;
    }
    if (scanSignature !== lastScanSignature) {
      lastScanSignature = scanSignature;
      record(
        selected ? 'candidate' : 'baseline',
        candidates.length,
        topCandidates.length,
        controls,
        selected ?? undefined,
        selectedElement
      );
      discoveryLog('scan', {
        submittedAt: Boolean(submittedAt),
        candidateCount: candidates.length,
        selected: selected
          ? {
              tag: selected.tagName,
              testId: selected.testId,
              role: selected.role,
              text: selected.text.slice(0, 120)
            }
          : null,
        changedCandidates: topCandidates
      });
    }
    assistant = selectedElement;
    reportProgress();
    const responseIsReady =
      !workingElement &&
      (!observedGeneration && !workingLocator
        ? true
        : !observedGeneration && workingLocator
          ? selectedStableSince !== null && Date.now() - selectedStableSince >= 500
          : observedIdle &&
            selectedStableSince !== null &&
            Date.now() - selectedStableSince >= COMPLETION_STABILITY_MS);
    if (composer && assistant && responseIsReady) {
      const draftSignature = `${selectedSignature}:${observedGeneration}:${observedIdle}:${generatingLocator?.segments.join('/') ?? ''}:${idleControl ? locator(idleControl).segments.join('/') : ''}`;
      if (draftSignature !== lastDraftSignature) {
        lastDraftSignature = draftSignature;
        discoveryLog('response selected, emitting draft', {
          responseTestId: assistant.getAttribute('data-testid'),
          responseText: assistant.innerText?.slice(0, 120)
        });
        emit();
      }
    }
  };
  const observer = new MutationObserver(scan);
  const poller = window.setInterval(scan, 500);
  const captureSubmissionBaseline = () => {
    const elements = allElements('*');
    submissionTexts = new Set(elements.map((element) => element.innerText?.trim() ?? ''));
    submissionElements = new WeakSet(elements);
    submissionTurnIds = new Set(
      elements.map(stableTurnIdentity).filter((identity): identity is string => Boolean(identity))
    );
    submissionAssistantCount = elements.filter((element) => {
      const value = descriptor(element, baselineTexts);
      return (
        value.visible &&
        Boolean(value.text.trim()) &&
        hasAssistantMarker(value) &&
        scoreAssistantCandidate(value) !== Number.NEGATIVE_INFINITY
      );
    }).length;
  };
  const onFocus = (event: FocusEvent) => {
    const target = event.composedPath()[0] ?? event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement)
    ) {
      composer = target;
      if (!composerSnapshotRecorded) {
        composerSnapshotRecorded = true;
        record('baseline', 0, 0, controlState());
      }
      reportProgress();
    }
  };
  const onInput = (event: Event) => {
    const target = event.composedPath()[0] ?? event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement)
    ) {
      composer = target;
      if (!composerSnapshotRecorded) {
        composerSnapshotRecorded = true;
        record('baseline', 0, 0, controlState());
      }
      discoveryLog('composer input observed', {
        tag: target.tagName,
        testId: target.getAttribute('data-testid'),
        textLength: (target.innerText ?? (target as HTMLInputElement).value ?? '').length
      });
      reportProgress();
    }
  };
  const onClick = (event: MouseEvent) => {
    const path = event.composedPath();
    const newConversationControls = findNewConversationControls();
    const newConversationControl = clickedNewConversationControl(path, newConversationControls);
    if (lastDraft?.profile.newConversation) {
      discoveryLog('click checked for new conversation', {
        matched: Boolean(newConversationControl),
        path: path
          .filter((target): target is HTMLElement => target instanceof HTMLElement)
          .map((element) => ({
            tag: element.tagName,
            title: element.getAttribute('title'),
            ariaLabel: element.getAttribute('aria-label'),
            dataTest: element.getAttribute('data-test'),
            trackingTest: element.getAttribute('trackingtest')
          }))
          .slice(0, 8)
      });
    }
    if (lastDraft && newConversationControl) {
      const controlLocator = newConversationLocator(newConversationControl);
      const beforeAssistant = queryShadowLocator(
        lastDraft.profile.assistantMessages.locator
      ).filter(isVisible);
      pendingNewConversation = {
        controlLocator,
        controlSelectors: [controlLocator.segments.at(-1)!],
        destinationUrl: newConversationTargetUrl(newConversationControl),
        beforeUrl: location.href,
        beforeAssistantCount: beforeAssistant.length,
        beforeAssistant,
        expiresAt: Date.now() + NEW_CONVERSATION_WINDOW_MS,
        emptySince: null
      };
      discoveryLog('new conversation control clicked', {
        tag: newConversationControl.tagName,
        href:
          newConversationControl instanceof HTMLAnchorElement
            ? newConversationControl.href
            : undefined,
        beforeAssistantCount: pendingNewConversation.beforeAssistantCount
      });
      reportProgress();
      return;
    }
    // A subsequent interaction cannot confirm the earlier New Chat click.
    if (pendingNewConversation) {
      pendingNewConversation = null;
      reportProgress();
    }
    const target = path.find((entry): entry is HTMLElement => entry instanceof HTMLElement);
    const control = target?.closest('button,[role="button"]') as HTMLElement | null;
    if (control) {
      const label =
        `${control.getAttribute('aria-label') ?? ''} ${control.textContent ?? ''} ${control.getAttribute('data-testid') ?? ''}`.toLowerCase();
      if (/send|submit|enter|ask|run/.test(label)) {
        submit = control;
        submittedAt = Date.now();
        captureSubmissionBaseline();
        record('submitted', 0, 0, controlState());
        discoveryLog('send control observed', {
          tag: control.tagName,
          testId: control.getAttribute('data-testid'),
          ariaLabel: control.getAttribute('aria-label')
        });
        reportProgress();
      }
    }
  };
  const onKey = (event: KeyboardEvent) => {
    const target = event.composedPath()[0] ?? event.target;
    if (event.key === 'Enter' && !event.shiftKey) {
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLInputElement)
      )
        composer = target;
      submit = submit ?? composer;
      submittedAt = Date.now();
      captureSubmissionBaseline();
      record('submitted', 0, 0, controlState());
      discoveryLog('Enter submission observed', {
        composerTag: composer?.tagName,
        composerTestId: composer?.getAttribute('data-testid')
      });
      reportProgress();
    }
  };
  const onSubmit = () => {
    submittedAt = Date.now();
    captureSubmissionBaseline();
    record('submitted', 0, 0, controlState());
    reportProgress();
    discoveryLog('form submission observed');
  };
  const emit = () => {
    if (!composer || !assistant) return;
    emitted = true;
    const submitLocator = [...trace.events].reverse().find((event) => event.phase === 'submitted')
      ?.selectedElements?.submit?.locator;
    const newConversation = findNewConversationControls();
    const newConversationProfile =
      newConversation.length > 0
        ? {
            action: newConversationTargetUrl(newConversation[0])
              ? ('navigate' as const)
              : ('click' as const),
            ...(newConversationTargetUrl(newConversation[0])
              ? { url: newConversationTargetUrl(newConversation[0]) }
              : {}),
            locator: newConversationLocator(newConversation[0]),
            locators: newConversation.map(newConversationLocator),
            confirmation: 'context-change' as const
          }
        : undefined;
    const profile: BrowserProviderProfile = {
      schemaVersion: 1,
      id:
        origin
          .replace(/[^a-z0-9]+/gi, '-')
          .replace(/^-|-$/g, '')
          .toLowerCase() || 'learned-provider',
      name: location.hostname,
      match: { origins: [origin] },
      composer: {
        locator: locator(composer),
        inputMode: composer.isContentEditable
          ? 'contenteditable'
          : composer instanceof HTMLTextAreaElement
            ? 'textarea'
            : 'input'
      },
      submit: submitLocator ? { action: 'click', locator: submitLocator } : { action: 'enter' },
      assistantMessages: { locator: locator(assistant) },
      completion: {
        stabilityMs: COMPLETION_STABILITY_MS,
        ...(generatingLocator ? { generatingLocator } : {}),
        ...(idleControl
          ? { idleLocator: controlLocator(idleControl, 'idle') }
          : !observedGeneration && submit && submit !== composer
            ? { idleLocator: withFinalSelector(locator(submit), ':not([disabled])') }
            : {}),
        ...(workingLocator ? { workingLocator } : {})
      },
      ...(newConversationProfile ? { newConversation: newConversationProfile } : {}),
      learned: {
        sourceOrigin: origin,
        createdAt: startedAt,
        updatedAt: new Date().toISOString(),
        confidence: {
          composer: confidence(composer),
          submit: submit ? confidence(submit) : 'medium',
          assistantMessages: confidence(assistant)
        }
      }
    };
    trace.selectorValidation = {
      composer: validateLocator(profile.composer.locator),
      submit: profile.submit.locator
        ? validateLocator(profile.submit.locator)
        : { valid: true, matchCount: 0, visible: true },
      assistant: validateLocator(profile.assistantMessages.locator)
    };
    record(
      'final',
      lastCandidateCount,
      lastChangedCandidateCount,
      lastControls,
      lastSelected,
      assistant
    );
    const replay = replayProviderProfile(profile, trace);
    lastDraftReady = replay.passed;
    const draft: BrowserProviderDiscoveryDraft = {
      profile,
      readyToSave: replay.passed,
      validationReasons: replay.reasons,
      validationIssues: replay.issues,
      trace,
      capabilities: [
        {
          id: 'composer',
          label: 'Composer',
          confidence: confidence(composer),
          detail: 'Found the message input.'
        },
        {
          id: 'submit',
          label: 'Send',
          confidence: submit ? confidence(submit) : 'medium',
          detail: submit ? 'Found the send action.' : 'Will submit with Enter.'
        },
        {
          id: 'assistantMessages',
          label: 'Response',
          confidence: confidence(assistant),
          detail: 'Observed a new response element.'
        },
        {
          id: 'completion',
          label: 'Completion',
          confidence:
            observedGeneration && observedIdle ? 'high' : observedGeneration ? 'medium' : 'low',
          detail:
            observedGeneration && observedIdle
              ? 'Observed the generation control and its idle transition.'
              : workingLocator
                ? 'Observed assistant-scoped activity ending; completion remains inferred from response stability.'
                : observedGeneration
                  ? 'Observed generation, but not the idle transition yet.'
                  : 'No generation or working transition observed; completion cannot be validated.'
        },
        newConversationCapability({ profile, trace, validationIssues: replay.issues })
      ]
    };
    lastDraft = draft;
    onDraft(draft);
  };
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('submit', onSubmit, true);
  for (const root of roots(document))
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'aria-label',
        'aria-busy',
        'title',
        'disabled',
        'class',
        'data-is-streaming'
      ]
    });
  const stop = () => {
    stopped = true;
    pendingNewConversation = null;
    observer.disconnect();
    window.clearInterval(poller);
    document.removeEventListener('focusin', onFocus, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('submit', onSubmit, true);
  };
  const capture = (): boolean => {
    if (stopped || emitted || !composer || !assistant) return false;
    discoveryLog('manual capture requested', {
      composerTag: composer.tagName,
      assistantTag: assistant.tagName
    });
    emit();
    return emitted;
  };
  // Show the waiting checks as soon as the observer is installed, before any input.
  reportProgress();
  return { stop, capture };
}
