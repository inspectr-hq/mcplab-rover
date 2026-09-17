import { describe, expect, it } from 'vitest';
import { replayProviderProfile } from '../src/providers/discovery-replay';

const profile = {
  schemaVersion: 1 as const,
  id: 'example',
  name: 'Example',
  match: { origins: ['https://example.com'] },
  composer: { locator: { segments: ['textarea'] }, inputMode: 'textarea' as const },
  submit: { action: 'click' as const, locator: { segments: ['button[aria-label="Send"]'] } },
  assistantMessages: { locator: { segments: ['[data-role="assistant"]'] } },
  completion: {
    generatingLocator: { segments: ['button[aria-label="Send"]:disabled'] },
    idleLocator: { segments: ['button[aria-label="Send"]:not([disabled])'] },
    stabilityMs: 2500
  },
  learned: {
    sourceOrigin: 'https://example.com',
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    confidence: {}
  }
};

const trace = {
  observedGeneration: true,
  selectorValidation: {
    composer: { valid: true, matchCount: 1, visible: true },
    submit: { valid: true, matchCount: 1, visible: true },
    assistant: { valid: true, matchCount: 1, visible: true }
  },
  events: [
    {
      phase: 'baseline' as const,
      at: '',
      candidateCount: 1,
      changedCandidateCount: 0,
      visibleControlCount: 1,
      disabledControlCount: 0,
      snapshot: [
        { selector: 'textarea', tagName: 'TEXTAREA', visible: true, disabled: false, textLength: 0 }
      ]
    },
    {
      phase: 'submitted' as const,
      at: '',
      candidateCount: 1,
      changedCandidateCount: 0,
      visibleControlCount: 1,
      disabledControlCount: 1,
      snapshot: [
        {
          selector: 'button[aria-label="Send"]',
          tagName: 'BUTTON',
          visible: true,
          disabled: true,
          textLength: 0
        }
      ]
    },
    {
      phase: 'generating' as const,
      at: '',
      candidateCount: 1,
      changedCandidateCount: 1,
      visibleControlCount: 1,
      disabledControlCount: 1,
      snapshot: [
        {
          selector: 'button[aria-label="Send"]',
          tagName: 'BUTTON',
          visible: true,
          disabled: true,
          textLength: 0
        }
      ]
    },
    {
      phase: 'final' as const,
      at: '',
      candidateCount: 2,
      changedCandidateCount: 1,
      visibleControlCount: 1,
      disabledControlCount: 0,
      snapshot: [
        {
          selector: 'button[aria-label="Send"]',
          tagName: 'BUTTON',
          visible: true,
          disabled: false,
          textLength: 0
        },
        {
          selector: '[data-role="assistant"]',
          tagName: 'DIV',
          visible: true,
          disabled: false,
          textLength: 20
        }
      ]
    }
  ]
};

describe('provider discovery replay', () => {
  it('passes a profile whose selectors match the observed lifecycle', () => {
    expect(replayProviderProfile(profile, trace).passed).toBe(true);
  });

  it('rejects a profile with an unobserved idle selector', () => {
    const result = replayProviderProfile(
      {
        ...profile,
        completion: { ...profile.completion, idleLocator: { segments: ['button.nope'] } }
      },
      trace
    );
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain(
      'Idle selector was not observed in an enabled final snapshot.'
    );
  });
});
