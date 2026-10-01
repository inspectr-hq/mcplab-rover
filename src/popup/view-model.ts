import type { CheckCounts, LiveTestCatalogItem } from '../mcplab/types';
import type { BrowserProviderProfile } from '../mcplab/types';
import type { DebugSnapshot } from '../contracts';
import { isCompletedQueueItemStatus, type RoverQueueItem } from '../queue/state';

export type PopupMode = 'manual' | 'queue' | 'learn' | 'debug';

export const managedPhaseLabels: Record<string, string> = {
  offered: 'Offer received',
  accepted: 'Assignment accepted',
  running: 'Running in agent',
  finalizing: 'Finalizing in MCPLab',
  waiting_ack: 'Waiting for MCPLab acknowledgement',
  terminal: 'Stopped'
};

export function managedPhaseLabel(phase: string | undefined): string | undefined {
  return phase ? managedPhaseLabels[phase] : undefined;
}

export function modeVisibility(
  mode: PopupMode,
  hasManualSession: boolean
): { catalog: boolean; session: boolean; queue: boolean; debug: boolean } {
  if (mode === 'debug') return { catalog: false, session: false, queue: false, debug: true };
  if (mode === 'learn') return { catalog: false, session: false, queue: false, debug: false };
  return mode === 'manual'
    ? { catalog: !hasManualSession, session: hasManualSession, queue: false, debug: false }
    : { catalog: false, session: false, queue: true, debug: false };
}

export function filterTestCases(
  items: LiveTestCatalogItem[],
  query: string
): LiveTestCatalogItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    `${item.name} ${item.id} ${item.tags?.join(' ') ?? ''}`.toLowerCase().includes(needle)
  );
}

export function formatCheckCounts(counts: CheckCounts): string {
  return `${counts.passed} passed · ${counts.failed} failed · ${counts.not_evaluated} not evaluated`;
}

export function suggestedProviderName(
  profile: Pick<BrowserProviderProfile, 'name' | 'match'>
): string {
  const name = profile.name.trim();
  if (name) return name;
  const origin = profile.match.origins[0];
  if (!origin) return '';
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function buildLearnedProviderSave(
  profile: BrowserProviderProfile,
  name: string,
  targetProviderId: string | undefined,
  sourceUrl: string | undefined
): {
  profile: BrowserProviderProfile;
  agent: { id: string; name: string; url: string };
} {
  const providerOrigin = profile.match.origins[0];
  if (!providerOrigin) throw new Error('The learned provider has no page origin.');
  const savedProfile = {
    ...profile,
    id:
      targetProviderId ??
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    name
  };
  return {
    profile: savedProfile,
    agent: {
      id: `${savedProfile.id}-browser`,
      name: `${name} browser`,
      url: sourceUrl ?? providerOrigin
    }
  };
}

function profileLocator(locator: { segments: string[] } | undefined): string {
  return locator?.segments.at(-1) ?? 'not configured';
}

export function profileSummary(
  profile: BrowserProviderProfile
): Array<{ label: string; value: string }> {
  const completion = profile.completion;
  const newConversation = profile.newConversation;
  return [
    { label: 'Composer', value: profileLocator(profile.composer.locator) },
    {
      label: 'Send',
      value: profile.submit.locator
        ? `${profile.submit.action}, ${profileLocator(profile.submit.locator)}`
        : profile.submit.action
    },
    { label: 'Response', value: profileLocator(profile.assistantMessages.locator) },
    { label: 'Generation', value: profileLocator(completion.generatingLocator) },
    { label: 'Working', value: profileLocator(completion.workingLocator) },
    { label: 'Idle', value: profileLocator(completion.idleLocator) },
    {
      label: 'New conversation',
      value: newConversation
        ? newConversation.action === 'navigate'
          ? `navigate, ${newConversation.url}`
          : `click, ${profileLocator(newConversation.locator ?? newConversation.locators?.[0])}`
        : 'not configured'
    }
  ];
}

export function learnResultStatus(input: {
  readyToSave: boolean;
  hasNewConversation: boolean;
  newConversationContextObserved: boolean;
  validationReason?: string;
}): string {
  if (!input.readyToSave)
    return `Sample captured, but save validation failed. ${input.validationReason ?? 'Review the validation details below.'}`;
  if (input.newConversationContextObserved)
    return 'Response captured. New Chat context change observed. Review the capabilities, name the provider, and save it.';
  if (input.hasNewConversation)
    return 'Response captured. To confirm a new conversation, click New Chat on the provider page now; then review and save.';
  return 'Sample captured. Review the capabilities, name the provider, and save it.';
}

export function debugFingerprint(snapshot: DebugSnapshot): string {
  return JSON.stringify({
    endpoint: {
      origin: snapshot.endpoint.origin,
      connected: snapshot.endpoint.connected,
      error: snapshot.endpoint.error
    },
    page: snapshot.page,
    elements: snapshot.elements,
    rover: snapshot.rover
  });
}

export function debugCheckedLabel(checkedAt: string): string {
  return `Last checked ${new Date(checkedAt).toLocaleTimeString()}`;
}

export function splitQueueItems(
  items: RoverQueueItem[],
  evaluationRunId?: string
): {
  active: RoverQueueItem[];
  completed: RoverQueueItem[];
  managed: boolean;
} {
  return {
    active: items.filter((item) => !isCompletedQueueItemStatus(item.status)),
    completed: items.filter((item) => isCompletedQueueItemStatus(item.status)),
    managed: Boolean(evaluationRunId)
  };
}

export function projectQueueForProvider(
  queue: {
    provider: string;
    items: RoverQueueItem[];
    recentHistory?: Record<string, RoverQueueItem[]>;
    evaluationRunId?: string;
  },
  provider?: string
): {
  active: RoverQueueItem[];
  completed: RoverQueueItem[];
  managed: boolean;
  matchesCurrentAssignment: boolean;
} {
  const matchesCurrentAssignment = Boolean(provider && queue.provider === provider);
  // Keep server-managed assignments visible even when the current page is a
  // different provider. The popup can still filter completed history, but an
  // active assignment should never look like an empty queue.
  const split = splitQueueItems(queue.items, queue.evaluationRunId);
  return {
    active: matchesCurrentAssignment || split.managed ? split.active : [],
    completed:
      queue.recentHistory?.[provider ?? ''] ?? (matchesCurrentAssignment ? split.completed : []),
    managed: split.managed,
    matchesCurrentAssignment
  };
}
