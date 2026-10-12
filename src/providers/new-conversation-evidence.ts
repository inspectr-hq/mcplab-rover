import type { BrowserProviderDiscoveryDraft, BrowserProviderDiscoveryTrace } from '../contracts';
import type { BrowserProviderProfile } from '../mcplab/types';

export const NEW_CONVERSATION_WINDOW_MS = 5000;
export const NEW_CONVERSATION_STABILITY_MS = 500;

/** Old single-signal traces remain readable, but do not raise confidence. */
export function hasConfirmedNewConversationEvidence(
  evidence: BrowserProviderDiscoveryTrace['newConversationEvidence']
): boolean {
  return Boolean(
    evidence &&
    evidence.beforeAssistantCount > 0 &&
    evidence.afterAssistantCount === 0 &&
    evidence.composerEmpty === true &&
    evidence.emptyChatStableMs !== undefined &&
    evidence.emptyChatStableMs >= NEW_CONVERSATION_STABILITY_MS &&
    evidence.elapsedMs !== undefined &&
    evidence.elapsedMs >= evidence.emptyChatStableMs &&
    evidence.elapsedMs < NEW_CONVERSATION_WINDOW_MS
  );
}

export function matchesNewConversationDestination(
  configured: BrowserProviderProfile['newConversation'],
  evidence: BrowserProviderDiscoveryTrace['newConversationEvidence']
): boolean {
  if (configured?.action !== 'navigate') return true;
  if (!configured.url || !evidence?.destinationUrl) return false;
  try {
    const configuredUrl = new URL(configured.url);
    const observedUrl = new URL(evidence.destinationUrl);
    configuredUrl.hash = '';
    observedUrl.hash = '';
    return (
      ['http:', 'https:'].includes(configuredUrl.protocol) &&
      configuredUrl.href === observedUrl.href
    );
  } catch {
    return false;
  }
}

type ConfirmationDraft = Pick<
  BrowserProviderDiscoveryDraft,
  'profile' | 'trace' | 'validationIssues'
>;

export function isNewConversationConfirmed(draft: ConfirmationDraft | null | undefined): boolean {
  return Boolean(
    draft?.profile.newConversation &&
    hasConfirmedNewConversationEvidence(draft.trace?.newConversationEvidence) &&
    matchesNewConversationDestination(
      draft.profile.newConversation,
      draft.trace?.newConversationEvidence
    ) &&
    !draft.validationIssues?.some((issue) => issue.code === 'new-chat-control-mismatch')
  );
}

export function newConversationCapability(
  draft: ConfirmationDraft
): BrowserProviderDiscoveryDraft['capabilities'][number] {
  const configured = draft.profile.newConversation;
  const evidence = draft.trace?.newConversationEvidence;
  const confirmed = isNewConversationConfirmed(draft);
  return {
    id: 'newConversation',
    label: 'New conversation',
    confidence: confirmed ? 'medium' : 'low',
    detail:
      confirmed && evidence
        ? `Within about ${(evidence.elapsedMs! / 1000).toFixed(1)} seconds of the click, all ${evidence.beforeAssistantCount} prior visible response matches were no longer visible and a visible empty message input was observed for ${evidence.emptyChatStableMs} ms.${evidence.signal === 'url-changed' ? ' The page URL also changed.' : ''} This confirms page state, without verifying a conversation identity.`
        : configured
          ? 'A New Chat action is configured; opening a new conversation is not yet confirmed.'
          : 'Not available for this provider.'
  };
}
