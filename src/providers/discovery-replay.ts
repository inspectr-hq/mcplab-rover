import type {
  BrowserProviderDiscoveryTrace,
  BrowserProviderDiscoveryTraceEvent
} from '../contracts';
import type { BrowserProviderProfile, ShadowLocator } from '../mcplab/types';

export interface DiscoveryReplayResult {
  passed: boolean;
  reasons: string[];
}

function lastSelector(locator: ShadowLocator | undefined): string | undefined {
  return locator?.segments.at(-1);
}

function matchesSelector(selector: string | undefined, candidate: string): boolean {
  if (!selector) return false;
  return (
    selector === candidate || selector.replace(/:disabled|:not\(\[disabled\]\)/g, '') === candidate
  );
}

function matchesObservedSelector(
  profileSelector: string,
  selected: NonNullable<SelectionRole[keyof SelectionRole]>
): boolean {
  if (selected.selectors.some((candidate) => matchesSelector(profileSelector, candidate)))
    return true;
  const attributes = profileSelector.match(/\[[^\]]+\]/g) ?? [];
  if (attributes.length < 2) return false;
  return attributes.every((attribute) =>
    selected.selectors.some(
      (candidate) => matchesSelector(attribute, candidate) || candidate.includes(attribute)
    )
  );
}

function matchesGeneratingState(
  selector: string | undefined,
  node: { selector: string; disabled: boolean }
): boolean {
  if (!selector) return false;
  if (selector.includes(':disabled') && !node.disabled) return false;
  if (selector.includes(':not([disabled])') && node.disabled) return false;
  return matchesSelector(selector, node.selector);
}

type SelectionRole = NonNullable<BrowserProviderDiscoveryTraceEvent['selectedElements']>;

function selectedEvidence(
  events: BrowserProviderDiscoveryTraceEvent[],
  role: keyof SelectionRole,
  phases: BrowserProviderDiscoveryTraceEvent['phase'][]
) {
  return events.flatMap((event, index) =>
    phases.includes(event.phase) && event.selectedElements?.[role]
      ? [{ index, element: event.selectedElements[role]! }]
      : []
  );
}

function matchesSelectedLocator(
  profileLocator: ShadowLocator | undefined,
  selected: NonNullable<SelectionRole[keyof SelectionRole]>
): boolean {
  if (!profileLocator?.segments.length) return false;
  const segments = profileLocator.segments;
  const selectedSegments = selected.locator.segments;
  if (segments.length !== selectedSegments.length) return false;
  if (segments.slice(0, -1).some((segment, index) => segment !== selectedSegments[index]))
    return false;
  const last = segments.at(-1)!;
  return matchesObservedSelector(last, selected);
}

export function replayProviderProfile(
  profile: BrowserProviderProfile,
  trace: BrowserProviderDiscoveryTrace | undefined
): DiscoveryReplayResult {
  const reasons: string[] = [];
  if (!trace) return { passed: false, reasons: ['Learning trace is missing.'] };
  const events = trace.events ?? [];
  const snapshots = (phase: string) =>
    events.filter((event) => event.phase === phase).flatMap((event) => event.snapshot ?? []);
  const composer = lastSelector(profile.composer.locator);
  const assistant = lastSelector(profile.assistantMessages.locator);
  const submit = lastSelector(profile.submit.locator);
  const composerSelections = selectedEvidence(events, 'composer', ['baseline', 'submitted']);
  if (composerSelections.length > 0) {
    if (
      !composerSelections.some(({ element }) =>
        matchesSelectedLocator(profile.composer.locator, element)
      )
    )
      reasons.push('Composer selector does not identify the selected composer.');
  } else if (trace.evidenceVersion === 1) {
    reasons.push('Selected composer evidence is missing from the Learning trace.');
  } else if (
    !snapshots('baseline')
      .concat(snapshots('submitted'))
      .some((node) => matchesSelector(composer, node.selector))
  )
    reasons.push('Composer selector was not observed in the baseline snapshot.');
  if (profile.submit.action === 'click') {
    const submitSelections = selectedEvidence(events, 'submit', ['submitted']);
    if (submitSelections.length > 0) {
      if (
        !submitSelections.some(({ element }) =>
          matchesSelectedLocator(profile.submit.locator, element)
        )
      )
        reasons.push('Submit selector does not identify the selected send control.');
    } else if (trace.evidenceVersion === 1)
      reasons.push('Selected send-control evidence is missing from the Learning trace.');
    else if (!snapshots('submitted').some((node) => matchesSelector(submit, node.selector)))
      reasons.push('Submit selector was not observed in the submitted snapshot.');
  }
  const assistantSelections = selectedEvidence(events, 'assistant', ['candidate', 'final']);
  if (assistantSelections.length > 0) {
    const matchingSelections = assistantSelections.filter(({ element }) =>
      matchesSelectedLocator(profile.assistantMessages.locator, element)
    );
    if (matchingSelections.length === 0)
      reasons.push('Assistant selector does not identify the selected response.');
    else if (
      matchingSelections.every(({ element }) => {
        const selector = lastSelector(profile.assistantMessages.locator);
        const evaluation = element.selectorEvaluations?.[selector ?? ''];
        return evaluation !== undefined && evaluation.nonAssistantCount > 0;
      })
    )
      reasons.push('Assistant selector also matched non-assistant elements.');
    const submittedIndex = events.findIndex((event) => event.phase === 'submitted');
    if (
      submittedIndex < 0 ||
      !matchingSelections.some(
        ({ index, element }) =>
          index > submittedIndex &&
          (trace.evidenceVersion === 1
            ? element.changedAfterSubmission === true
            : element.changedFromBaseline === true)
      )
    )
      reasons.push('Selected assistant response was not observed changing after submission.');
    if (
      trace.evidenceVersion === 1 &&
      !matchingSelections.some(
        ({ index, element }) => index > submittedIndex && element.absentAtSubmission === true
      )
    )
      reasons.push('Selected assistant response was not a new turn after submission.');
  } else if (trace.evidenceVersion === 1) {
    reasons.push('Selected assistant evidence is missing from the Learning trace.');
  } else if (
    !snapshots('candidate')
      .concat(snapshots('final'))
      .some((node) => matchesSelector(assistant, node.selector))
  )
    reasons.push('Assistant selector was not observed in a response snapshot.');
  const generating = lastSelector(profile.completion.generatingLocator);
  const submittedIndex = events.findIndex((event) => event.phase === 'submitted');
  const workingSelections = selectedEvidence(events, 'working', ['working']);
  const finalWorkingSelections = selectedEvidence(events, 'working', ['final']);
  const finalIndex = events.map((event) => event.phase).lastIndexOf('final');
  const observedWorkingEnd =
    finalIndex >= 0 &&
    events[finalIndex].workingActive === false &&
    workingSelections.some(({ index }) => index < finalIndex);
  if ((!generating || !trace.observedGeneration) && !observedWorkingEnd)
    reasons.push('No observed generation or working-to-ready transition supports completion.');
  else if (generating && trace.observedGeneration) {
    const generatingSelections = selectedEvidence(events, 'generating', ['generating']);
    if (
      trace.evidenceVersion === 1 &&
      !generatingSelections.some(({ index }) => index > submittedIndex && index < finalIndex)
    )
      reasons.push('Generation signal was not observed after submission and before final.');
    if (generatingSelections.length > 0) {
      if (
        !generatingSelections.some(({ element }) =>
          matchesSelectedLocator(profile.completion.generatingLocator, element)
        )
      )
        reasons.push('Generation selector does not identify the observed generation control.');
    } else if (trace.evidenceVersion === 1)
      reasons.push('Selected generation-control evidence is missing from the Learning trace.');
    else if (!snapshots('generating').some((node) => matchesSelector(generating, node.selector)))
      reasons.push('Generation selector was not observed in the generating snapshot.');
  }
  const idle = lastSelector(profile.completion.idleLocator);
  if (profile.completion.workingLocator) {
    if (
      trace.evidenceVersion === 1 &&
      !workingSelections.some(({ index }) => index > submittedIndex && index < finalIndex)
    )
      reasons.push('Working signal was not observed after submission and before final.');
    if (
      !workingSelections.some(({ element }) =>
        matchesSelectedLocator(profile.completion.workingLocator, element)
      )
    )
      reasons.push('Working selector does not identify an observed working indicator.');
    if (
      finalWorkingSelections.some(({ element }) =>
        matchesSelectedLocator(profile.completion.workingLocator, element)
      )
    )
      reasons.push('Working selector remains active in the final state.');
  }
  if (!idle) {
    const generatingStillPresent = snapshots('final').some((node) =>
      matchesGeneratingState(generating, node)
    );
    if (generatingStillPresent)
      reasons.push('The generation control was still present in the final snapshot.');
  } else {
    const idleSelections = selectedEvidence(events, 'idle', ['final']);
    if (idleSelections.length > 0) {
      if (
        !idleSelections.some(({ element }) =>
          matchesSelectedLocator(profile.completion.idleLocator, element)
        )
      )
        reasons.push('Idle selector does not identify the observed ready control.');
    } else if (trace.evidenceVersion === 1)
      reasons.push('Selected idle-control evidence is missing from the Learning trace.');
    else if (
      !snapshots('final').some((node) => matchesSelector(idle, node.selector) && !node.disabled)
    )
      reasons.push('Idle selector was not observed in an enabled final snapshot.');
  }
  if (
    profile.newConversation?.action === 'click' &&
    profile.newConversation.confirmation === 'context-change' &&
    !trace.newConversationEvidence
  )
    reasons.push('New Chat context change was not observed during Learning.');
  if (trace.newConversationEvidence) {
    const evidence = trace.newConversationEvidence;
    const configured = profile.newConversation;
    const locators =
      configured?.action === 'click' ? [configured.locator, ...(configured.locators ?? [])] : [];
    if (
      !locators.some((value) =>
        matchesSelectedLocator(value, {
          locator: evidence.controlLocator,
          selectors: evidence.controlSelectors,
          visible: true,
          textLength: 0
        })
      )
    )
      reasons.push('New Chat selector does not identify the confirmed control.');
  }
  return { passed: reasons.length === 0, reasons };
}
