import type { BrowserProviderLearningDraft } from '../contracts';
import type { BrowserProviderProfile, ShadowLocator } from '../mcplab/types';
import { selectAssistantCandidate, type ChatCandidateDescriptor } from './candidate-descriptor';

const LEARNING_LOG = '[MCPLab Rover][learning]';

function learningLog(message: string, details?: unknown): void {
  if (details === undefined) console.info(`${LEARNING_LOG} ${message}`);
  else console.info(`${LEARNING_LOG} ${message}`, details);
}

function visible(element: Element): boolean {
  const node = element as HTMLElement;
  const rect = node.getBoundingClientRect();
  return getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function selector(element: Element): string {
  const html = element as HTMLElement;
  for (const attribute of ['data-message-author-role', 'data-testid', 'data-test', 'aria-label', 'name', 'id']) {
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
  return roots(document).flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>(selectorText)));
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
  return element.hasAttribute('data-message-author-role') || element.hasAttribute('data-testid') || element.hasAttribute('data-test') || element.hasAttribute('aria-label')
    ? 'high'
    : element.id || element.getAttribute('role') === 'article'
      ? 'medium'
      : 'low';
}

export function startLearning(onDraft: (draft: BrowserProviderLearningDraft) => void): () => void {
  let composer: HTMLElement | null = null;
  let submit: HTMLElement | null = null;
  let assistant: HTMLElement | null = null;
  let submittedAt = 0;
  let submissionArmed = false;
  let stopped = false;
  const startedAt = new Date().toISOString();
  const origin = location.origin;
  const baselineTexts = new Set(allElements('*').map((element) => element.innerText?.trim()).filter((text): text is string => Boolean(text)));
  let lastScanSignature = '';
  learningLog('started', { origin, href: location.href, baselineTextCount: baselineTexts.size });
  const scan = () => {
    if (stopped || assistant || (!submittedAt && !submissionArmed)) return;
    const candidates = allElements('*')
      .filter((element) => !element.isContentEditable && element !== composer && !composer?.contains(element))
      .filter((element) => element.children.length === 0 || (element.innerText?.length ?? 0) > 20)
      .map((element) => ({ element, descriptor: descriptor(element, baselineTexts) }));
    const selected = selectAssistantCandidate(candidates.map((candidate) => candidate.descriptor));
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
    const scanSignature = `${candidates.length}:${selected?.testId ?? selected?.tagName ?? 'none'}:${topCandidates.map((candidate) => `${candidate.testId ?? candidate.tag}:${candidate.text}`).join('|')}`;
    if (scanSignature !== lastScanSignature) {
      lastScanSignature = scanSignature;
      learningLog('scan', { submittedAt: Boolean(submittedAt), submissionArmed, candidateCount: candidates.length, selected: selected ? { tag: selected.tagName, testId: selected.testId, role: selected.role, text: selected.text.slice(0, 120) } : null, changedCandidates: topCandidates });
    }
    assistant = selected ? candidates.find((candidate) => candidate.descriptor === selected)?.element ?? null : null;
    if (composer && assistant) {
      learningLog('response selected, emitting draft', { responseTestId: assistant.getAttribute('data-testid'), responseText: assistant.innerText?.slice(0, 120) });
      emit();
    }
  };
  const observer = new MutationObserver(scan);
  const poller = window.setInterval(scan, 500);
  const onFocus = (event: FocusEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) composer = target;
  };
  const onInput = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) {
      composer = target;
      submissionArmed = true;
      learningLog('composer input observed', { tag: target.tagName, testId: target.getAttribute('data-testid'), textLength: (target.innerText ?? (target as HTMLInputElement).value ?? '').length });
    }
  };
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const control = target.closest('button,[role="button"]') as HTMLElement | null;
    if (control) {
      const label = `${control.getAttribute('aria-label') ?? ''} ${control.textContent ?? ''} ${control.getAttribute('data-testid') ?? ''}`.toLowerCase();
      if (/send|submit|enter|ask|run/.test(label)) {
        submit = control;
        submittedAt = Date.now();
        learningLog('send control observed', { tag: control.tagName, testId: control.getAttribute('data-testid'), ariaLabel: control.getAttribute('aria-label') });
      }
      else if (composer && !/new\s*(chat|conversation)|new\s*thread/.test(label)) submittedAt = Date.now();
    }
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)) composer = event.target;
      submit = submit ?? composer;
      submittedAt = Date.now();
      learningLog('Enter submission observed', { composerTag: composer?.tagName, composerTestId: composer?.getAttribute('data-testid') });
    }
  };
  const onSubmit = () => {
    submittedAt = Date.now();
    learningLog('form submission observed');
  };
  const emit = () => {
    if (!composer || !assistant) return;
    const submitLocator = submit && submit !== composer ? locator(submit) : undefined;
    const newConversation = allElements('button,[role="button"],a').find((element) => {
      if (!visible(element)) return false;
      const label = `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''} ${element.textContent ?? ''}`.toLowerCase();
      return /new\s*(chat|conversation)|new\s*thread|start\s*(a\s*)?new/.test(label);
    });
    const newConversationProfile = newConversation
      ? newConversation instanceof HTMLAnchorElement && newConversation.href
        ? { action: 'navigate' as const, url: newConversation.href }
        : { action: 'click' as const, locator: locator(newConversation) }
      : undefined;
    const profile: BrowserProviderProfile = {
      schemaVersion: 1,
      id: origin.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'learned-provider',
      name: location.hostname,
      match: { origins: [origin] },
      composer: { locator: locator(composer), inputMode: composer.isContentEditable ? 'contenteditable' : composer instanceof HTMLTextAreaElement ? 'textarea' : 'input' },
      submit: submitLocator ? { action: 'click', locator: submitLocator } : { action: 'enter' },
      assistantMessages: { locator: locator(assistant) },
      completion: { stabilityMs: 2500 },
      ...(newConversationProfile ? { newConversation: newConversationProfile } : {}),
      learned: { sourceOrigin: origin, createdAt: startedAt, updatedAt: new Date().toISOString(), confidence: { composer: confidence(composer), submit: submit ? confidence(submit) : 'medium', assistantMessages: confidence(assistant) } }
    };
    onDraft({ profile, capabilities: [
      { id: 'composer', label: 'Composer', confidence: confidence(composer), detail: 'Found the message input.' },
      { id: 'submit', label: 'Send', confidence: submit ? confidence(submit) : 'medium', detail: submit ? 'Found the send action.' : 'Will submit with Enter.' },
      { id: 'assistantMessages', label: 'Response', confidence: confidence(assistant), detail: 'Observed a new response element.' },
      { id: 'completion', label: 'Completion', confidence: 'medium', detail: 'Uses response stability.' },
      { id: 'newConversation', label: 'New conversation', confidence: newConversation ? confidence(newConversation) : 'low', detail: newConversation ? 'Found a new chat control.' : 'Not available for this provider.' }
    ] });
  };
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('submit', onSubmit, true);
  for (const root of roots(document)) observer.observe(root, { childList: true, subtree: true, characterData: true });
  return () => {
    stopped = true;
    observer.disconnect();
    window.clearInterval(poller);
    document.removeEventListener('focusin', onFocus, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('submit', onSubmit, true);
  };
}
