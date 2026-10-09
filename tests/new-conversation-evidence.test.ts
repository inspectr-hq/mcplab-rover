import { describe, expect, it } from 'vitest';
import type {
  BrowserProviderDiscoveryDraft,
  BrowserProviderDiscoveryValidationIssue
} from '../src/contracts';
import {
  isNewConversationConfirmed,
  newConversationCapability
} from '../src/providers/new-conversation-evidence';

const draft: BrowserProviderDiscoveryDraft = {
  profile: {
    schemaVersion: 1,
    id: 'example',
    name: 'Example',
    match: { origins: ['https://example.com'] },
    composer: { locator: { segments: ['textarea'] }, inputMode: 'textarea' },
    submit: { action: 'enter' },
    assistantMessages: { locator: { segments: ['article'] } },
    completion: { stabilityMs: 2500 },
    learned: { sourceOrigin: 'https://example.com', createdAt: '', updatedAt: '', confidence: {} },
    newConversation: {
      action: 'click',
      locator: { segments: ['button'] },
      confirmation: 'context-change'
    }
  },
  capabilities: [],
  trace: {
    observedGeneration: true,
    selectorValidation: {
      composer: { valid: true, matchCount: 1, visible: true },
      submit: { valid: true, matchCount: 1, visible: true },
      assistant: { valid: true, matchCount: 1, visible: true }
    },
    events: [],
    newConversationEvidence: {
      controlLocator: { segments: ['button'] },
      controlSelectors: ['button'],
      signal: 'assistant-count-reduced',
      beforeAssistantCount: 1,
      afterAssistantCount: 0,
      composerEmpty: true,
      emptyChatStableMs: 500,
      elapsedMs: 1234
    }
  }
};

describe('New Chat confirmation', () => {
  it('requires a configured capability and current evidence', () => {
    expect(isNewConversationConfirmed(draft)).toBe(true);
    expect(isNewConversationConfirmed(undefined)).toBe(false);
    expect(isNewConversationConfirmed(null)).toBe(false);
    expect(isNewConversationConfirmed({ ...draft, trace: undefined })).toBe(false);
    expect(
      isNewConversationConfirmed({
        ...draft,
        profile: { ...draft.profile, newConversation: undefined }
      })
    ).toBe(false);
  });

  it('rejects confirmed evidence for an unmatched control', () => {
    const unmatched = {
      ...draft,
      validationIssues: [
        {
          code: 'new-chat-control-mismatch' as const,
          blocking: false,
          message: 'Different control.'
        }
      ]
    };
    expect(isNewConversationConfirmed(unmatched)).toBe(false);
    expect(newConversationCapability(unmatched).confidence).toBe('low');
  });

  it('requires navigation evidence for the configured destination', () => {
    const navigation = {
      ...draft,
      profile: {
        ...draft.profile,
        newConversation: {
          action: 'navigate' as const,
          url: 'https://example.com/new',
          confirmation: 'context-change' as const
        }
      },
      trace: {
        ...draft.trace!,
        newConversationEvidence: {
          ...draft.trace!.newConversationEvidence!,
          destinationUrl: 'https://example.com/new'
        }
      }
    };
    expect(isNewConversationConfirmed(navigation)).toBe(true);
    expect(
      isNewConversationConfirmed({
        ...navigation,
        profile: {
          ...navigation.profile,
          newConversation: { ...navigation.profile.newConversation, url: 'https://example.com/old' }
        }
      })
    ).toBe(false);
  });

  it('rounds confirmation timing and describes visibility rather than DOM removal', () => {
    const capability = newConversationCapability(draft);
    expect(capability.detail).toContain('1.2 seconds');
    expect(capability.detail).not.toContain('1.234');
    expect(capability.detail).toContain('no longer visible');
  });
});

// @ts-expect-error Misspelled issue codes must fail typechecking.
const unknownCode: BrowserProviderDiscoveryValidationIssue['code'] = 'new-chat-unconfimed';
void unknownCode;
