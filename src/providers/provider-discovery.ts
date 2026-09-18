import type {
  BrowserProviderDiscoveryDraft,
  BrowserProviderDiscoveryProgress,
  BrowserProviderDiscoveryTrace,
  BrowserProviderDiscoveryTraceEvent
} from '../contracts';
import type { BrowserProviderProfile, ShadowLocator } from '../mcplab/types';
import { selectAssistantCandidate, type ChatCandidateDescriptor } from './candidate-descriptor';
import { replayProviderProfile } from './discovery-replay';
import { controlLabel, isGenerationControlLabel } from './control-labels';

const DISCOVERY_LOG = '[MCPLab Rover][provider-discovery]';

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

function selector(element: Element): string {
  const html = element as HTMLElement;
  for (const attribute of [
    'data-message-author-role',
    'data-testid',
    'data-test',
    'aria-label',
    'name',
    'id'
  ]) {
    const value = html.getAttribute(attribute);
    if (value?.trim()) return `[${attribute}="${CSS.escape(value)}"]`;
  }
  if (element.getAttribute('role') === 'article') return '[role="article"]';
  if (element.tagName === 'TEXTAREA') return 'textarea';
  if (element.tagName === 'INPUT') return 'input';
  if (html.isContentEditable) return '[contenteditable="true"]';
  return element.tagName.toLowerCase();
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

function findNewConversationControl(): HTMLElement | undefined {
  return allElements(
    'button,[role="button"],a,[tabindex]:not([tabindex="-1"]),[aria-label],[title],[data-test],[data-testid],[trackingtest]'
  ).find((element) => {
    if (!visible(element) || (element instanceof HTMLButtonElement && element.disabled))
      return false;
    const label =
      `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''} ${element.getAttribute('data-test') ?? ''} ${element.getAttribute('data-testid') ?? ''} ${element.getAttribute('trackingtest') ?? ''} ${element.textContent ?? ''}`.toLowerCase();
    return /new[\s_-]*(chat|conversation)|new[\s_-]*thread|start[\s_-]*(a[\s_-]*)?new/.test(label);
  });
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
    visibleControls.find((element) => element instanceof HTMLButtonElement && element.disabled) ??
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
    const matches = allElements(value.segments.at(-1) ?? '');
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
  let submit: HTMLElement | null = null;
  let assistant: HTMLElement | null = null;
  let submittedAt = 0;
  let submissionArmed = false;
  let emitted = false;
  let stopped = false;
  let observedGeneration = false;
  let observedIdle = false;
  let generatingLocator: ShadowLocator | undefined;
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
      submitDetected: Boolean(submit) || submissionArmed,
      assistantDetected: Boolean(assistant),
      ...(assistant?.innerText?.trim()
        ? { assistantPreview: assistant.innerText.trim().slice(0, 160) }
        : {}),
      generatingObserved: observedGeneration,
      idleObserved: observedIdle
    };
    const signature = JSON.stringify(progress);
    if (signature === lastProgressSignature) return;
    lastProgressSignature = signature;
    onProgress(progress);
  };
  const trace: BrowserProviderDiscoveryTrace = {
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
    selected?: ChatCandidateDescriptor
  ) => {
    trace.events.push({
      phase,
      at: new Date().toISOString(),
      candidateCount,
      changedCandidateCount,
      visibleControlCount: controls.visibleCount,
      disabledControlCount: controls.disabledCount,
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
      snapshot: lifecycleSnapshot()
    });
    if (trace.events.length > 32) trace.events.shift();
  };
  record('baseline', 0, 0, controlState());
  discoveryLog('started', { origin, href: location.href, baselineTextCount: baselineTexts.size });
  const scan = () => {
    if (stopped || emitted || (!submittedAt && !submissionArmed)) return;
    const candidates = allElements('*')
      .filter(
        (element) =>
          !element.isContentEditable && element !== composer && !composer?.contains(element)
      )
      .filter((element) => element.children.length === 0 || (element.innerText?.length ?? 0) > 20)
      .map((element) => ({ element, descriptor: descriptor(element, baselineTexts) }));
    const selected = selectAssistantCandidate(candidates.map((candidate) => candidate.descriptor));
    const controls = controlState();
    if (controls.generating) {
      observedGeneration = true;
      trace.observedGeneration = true;
      generatingLocator = controls.generatingControl
        ? controlLocator(controls.generatingControl, 'generating')
        : undefined;
      record('generating', candidates.length, 0, controls, selected ?? undefined);
    }
    if (observedGeneration && controls.idleControl && !controls.generating) observedIdle = true;
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
    const scanSignature = `${candidates.length}:${selected?.testId ?? selected?.tagName ?? 'none'}:${topCandidates.map((candidate) => `${candidate.testId ?? candidate.tag}:${candidate.text}`).join('|')}`;
    if (scanSignature !== selectedSignature) {
      selectedSignature = scanSignature;
      selectedStableSince = selected ? Date.now() : null;
    }
    if (scanSignature !== lastScanSignature) {
      lastScanSignature = scanSignature;
      record(
        selected ? 'candidate' : 'baseline',
        candidates.length,
        topCandidates.length,
        controls,
        selected ?? undefined
      );
      discoveryLog('scan', {
        submittedAt: Boolean(submittedAt),
        submissionArmed,
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
    assistant = selected
      ? (candidates.find((candidate) => candidate.descriptor === selected)?.element ?? null)
      : null;
    reportProgress();
    const responseIsReady =
      !observedGeneration ||
      (Boolean(controls.idleControl) &&
        !controls.generating &&
        selectedStableSince !== null &&
        Date.now() - selectedStableSince >= 500);
    if (composer && assistant && responseIsReady) {
      discoveryLog('response selected, emitting draft', {
        responseTestId: assistant.getAttribute('data-testid'),
        responseText: assistant.innerText?.slice(0, 120)
      });
      emit();
    }
  };
  const observer = new MutationObserver(scan);
  const poller = window.setInterval(scan, 500);
  const onFocus = (event: FocusEvent) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement)
    ) {
      composer = target;
      reportProgress();
    }
  };
  const onInput = (event: Event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement)
    ) {
      composer = target;
      submissionArmed = true;
      discoveryLog('composer input observed', {
        tag: target.tagName,
        testId: target.getAttribute('data-testid'),
        textLength: (target.innerText ?? (target as HTMLInputElement).value ?? '').length
      });
      reportProgress();
    }
  };
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const control = target.closest('button,[role="button"]') as HTMLElement | null;
    if (control) {
      const label =
        `${control.getAttribute('aria-label') ?? ''} ${control.textContent ?? ''} ${control.getAttribute('data-testid') ?? ''}`.toLowerCase();
      if (/send|submit|enter|ask|run/.test(label)) {
        submit = control;
        submittedAt = Date.now();
        record('submitted', 0, 0, controlState());
        discoveryLog('send control observed', {
          tag: control.tagName,
          testId: control.getAttribute('data-testid'),
          ariaLabel: control.getAttribute('aria-label')
        });
        reportProgress();
      } else if (composer && !/new\s*(chat|conversation)|new\s*thread/.test(label))
        submittedAt = Date.now();
    }
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLInputElement)
      )
        composer = event.target;
      submit = submit ?? composer;
      submittedAt = Date.now();
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
    record('submitted', 0, 0, controlState());
    reportProgress();
    discoveryLog('form submission observed');
  };
  const emit = () => {
    if (!composer || !assistant) return;
    emitted = true;
    const submitLocator = submit && submit !== composer ? locator(submit) : undefined;
    const newConversation = findNewConversationControl();
    const newConversationProfile = newConversation
      ? newConversation instanceof HTMLAnchorElement && newConversation.href
        ? { action: 'navigate' as const, url: newConversation.href }
        : { action: 'click' as const, locator: locator(newConversation) }
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
        stabilityMs: 2500,
        ...(generatingLocator
          ? { generatingLocator }
          : submit
            ? { generatingLocator: withFinalSelector(locator(submit), ':disabled') }
            : {}),
        ...(idleControl
          ? { idleLocator: controlLocator(idleControl, 'idle') }
          : submit
            ? { idleLocator: withFinalSelector(locator(submit), ':not([disabled])') }
            : {})
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
    record('final', lastCandidateCount, lastChangedCandidateCount, lastControls, lastSelected);
    const replay = replayProviderProfile(profile, trace);
    onDraft({
      profile,
      readyToSave: replay.passed,
      validationReasons: replay.reasons,
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
          confidence: observedGeneration && observedIdle ? 'high' : observedGeneration ? 'medium' : 'low',
          detail:
            observedGeneration && observedIdle
              ? 'Observed the generation control and its idle transition.'
              : observedGeneration
                ? 'Observed generation, but not the idle transition yet.'
                : 'No generation signal observed. Runtime will require a later generation transition.'
        },
        {
          id: 'newConversation',
          label: 'New conversation',
          confidence: newConversation ? confidence(newConversation) : 'low',
          detail: newConversation ? 'Found a new chat control.' : 'Not available for this provider.'
        }
      ]
    });
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
      attributeFilter: ['aria-label', 'title', 'disabled', 'class', 'data-is-streaming']
    });
  const stop = () => {
    stopped = true;
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
  return { stop, capture };
}
