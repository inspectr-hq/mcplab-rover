import type { BrowserProviderDiscoveryTrace } from '../contracts';
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

function matchesGeneratingState(
  selector: string | undefined,
  node: { selector: string; disabled: boolean }
): boolean {
  if (!selector) return false;
  if (selector.includes(':disabled') && !node.disabled) return false;
  if (selector.includes(':not([disabled])') && node.disabled) return false;
  return matchesSelector(selector, node.selector);
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
  if (
    !snapshots('baseline')
      .concat(snapshots('submitted'))
      .some((node) => matchesSelector(composer, node.selector))
  )
    reasons.push('Composer selector was not observed in the baseline snapshot.');
  if (
    profile.submit.action === 'click' &&
    !snapshots('submitted').some((node) => matchesSelector(submit, node.selector))
  )
    reasons.push('Submit selector was not observed in the submitted snapshot.');
  if (
    !snapshots('candidate')
      .concat(snapshots('final'))
      .some((node) => matchesSelector(assistant, node.selector))
  )
    reasons.push('Assistant selector was not observed in a response snapshot.');
  const generating = lastSelector(profile.completion.generatingLocator);
  if (!generating || !trace.observedGeneration)
    reasons.push('A generation selector and generation transition are required.');
  else if (!snapshots('generating').some((node) => matchesSelector(generating, node.selector)))
    reasons.push('Generation selector was not observed in the generating snapshot.');
  const idle = lastSelector(profile.completion.idleLocator);
  if (!idle) {
    const generatingStillPresent = snapshots('final').some((node) =>
      matchesGeneratingState(generating, node)
    );
    if (generatingStillPresent)
      reasons.push('The generation control was still present in the final snapshot.');
  } else if (
    !snapshots('final').some((node) => matchesSelector(idle, node.selector) && !node.disabled)
  )
    reasons.push('Idle selector was not observed in an enabled final snapshot.');
  return { passed: reasons.length === 0, reasons };
}
