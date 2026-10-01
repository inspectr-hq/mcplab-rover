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

const copilotWorkingTrace = {
  ...trace,
  events: [
    ...trace.events.slice(0, 3),
    {
      phase: 'working' as const,
      at: '',
      candidateCount: 2,
      changedCandidateCount: 1,
      visibleControlCount: 1,
      disabledControlCount: 0,
      workingActive: true,
      selectedElements: {
        working: {
          locator: { segments: ['[role="article"]'] },
          selectors: ['[role="article"]', 'div[aria-busy="true"]', 'div'],
          visible: true,
          textLength: 20
        }
      },
      snapshot: [
        {
          selector: '[role="article"]',
          tagName: 'DIV',
          visible: true,
          disabled: false,
          textLength: 20
        }
      ]
    },
    {
      ...trace.events[3],
      selectedElements: {
        working: {
          locator: { segments: ['[role="article"]'] },
          selectors: ['[role="article"]', 'div[aria-busy="false"]', 'div'],
          visible: true,
          textLength: 20
        }
      }
    }
  ]
};

describe('provider discovery replay', () => {
  it('does not validate a learned click New Chat action before context change is observed', () => {
    const result = replayProviderProfile({
      ...profile,
      newConversation: {
        action: 'click',
        locator: { segments: ['button[title="New chat"]'] },
        confirmation: 'context-change'
      }
    }, trace);
    expect(result.reasons).toContain('New Chat context change was not observed during Learning.');
  });

  it('rejects a New Chat proposal that does not identify the confirmed control', () => {
    const result = replayProviderProfile(
      {
        ...profile,
        newConversation: { action: 'click', locator: { segments: ['button.unrelated'] } }
      },
      {
        ...trace,
        newConversationEvidence: {
          controlLocator: { segments: ['[aria-label="New chat"]'] },
          controlSelectors: ['[aria-label="New chat"]', 'button'],
          signal: 'assistant-count-reduced',
          beforeAssistantCount: 1,
          afterAssistantCount: 0
        }
      }
    );
    expect(result.reasons).toContain('New Chat selector does not identify the confirmed control.');
  });

  it('rejects generation evidence that predates the submitted request', () => {
    const reordered = [trace.events[0], trace.events[2], trace.events[1], trace.events[3]];
    const result = replayProviderProfile(profile, {
      ...trace,
      evidenceVersion: 1,
      events: reordered.map((event) =>
        event.phase === 'generating'
          ? {
              ...event,
              selectedElements: {
                generating: {
                  locator: { segments: ['button[aria-label="Send"]'] },
                  selectors: ['button[aria-label="Send"]'],
                  visible: true,
                  textLength: 0
                }
              }
            }
          : event
      )
    });
    expect(result.reasons).toContain('Generation signal was not observed after submission and before final.');
  });

  it('does not combine a matching response with a different changed response', () => {
    const result = replayProviderProfile(profile, {
      ...trace,
      evidenceVersion: 1,
      events: trace.events.map((event) => {
        if (event.phase === 'final')
          return {
            ...event,
            selectedElements: {
              assistant: {
                locator: { segments: ['[data-role="assistant"]'] },
                selectors: ['[data-role="assistant"]'],
                visible: true,
                changedFromBaseline: false,
                textLength: 20
              }
            }
          };
        if (event.phase === 'generating')
          return {
            ...event,
            phase: 'candidate' as const,
            selectedElements: {
              assistant: {
                locator: { segments: ['[data-testid="other-answer"]'] },
                selectors: ['[data-testid="other-answer"]'],
                visible: true,
                changedFromBaseline: true,
                textLength: 20
              }
            }
          };
        return event;
      })
    });
    expect(result.reasons).toContain('Selected assistant response was not observed changing after submission.');
  });

  it('does not fall back to snapshot presence when a new trace lacks selected evidence', () => {
    const result = replayProviderProfile(profile, { ...trace, evidenceVersion: 1 });
    expect(result.reasons).toContain('Selected assistant evidence is missing from the Learning trace.');
  });

  it('rejects a broad assistant selector that also matched non-assistant elements', () => {
    const result = replayProviderProfile(
      { ...profile, assistantMessages: { locator: { segments: ['div'] } } },
      {
        ...trace,
        events: trace.events.map((event) =>
          event.phase === 'final'
            ? {
                ...event,
                selectedElements: {
                  assistant: {
                    locator: { segments: ['[data-role="assistant"]'] },
                    selectors: ['[data-role="assistant"]', 'div'],
                    selectorEvaluations: {
                      '[data-role="assistant"]': { matchCount: 1, nonAssistantCount: 0 },
                      div: { matchCount: 4, nonAssistantCount: 3 }
                    },
                    visible: true,
                    changedFromBaseline: true,
                    textLength: 20
                  }
                }
              }
            : event
        )
      }
    );
    expect(result.reasons).toContain('Assistant selector also matched non-assistant elements.');
  });

  it('validates the selected assistant rather than an unrelated snapshot match', () => {
    const withSelections = {
      ...trace,
      events: trace.events.map((event) =>
        event.phase === 'final'
          ? {
              ...event,
              selectedElements: {
                assistant: {
                  locator: { segments: ['[data-testid="actual-answer"]'] },
                  selectors: ['[data-testid="actual-answer"]', 'div'],
                  visible: true,
                  changedFromBaseline: true,
                  textLength: 20
                }
              }
            }
          : event
      )
    };
    const result = replayProviderProfile(profile, withSelections);
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('Assistant selector does not identify the selected response.');
  });

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

  it('accepts a generation-only profile when the generation control disappears', () => {
    const result = replayProviderProfile(
      {
        ...profile,
        completion: { generatingLocator: profile.completion.generatingLocator, stabilityMs: 2500 }
      },
      trace
    );
    expect(result).toEqual({ passed: true, reasons: [] });
  });

  it('accepts a transient compound working selector observed in the trace', () => {
    const result = replayProviderProfile(
      {
        ...profile,
        completion: {
          ...profile.completion,
          workingLocator: { segments: ['[role="article"][aria-busy="true"]'] }
        }
      },
      copilotWorkingTrace
    );
    expect(result).toEqual({ passed: true, reasons: [] });
  });

  it('rejects a persistent response container as the working selector', () => {
    const result = replayProviderProfile(
      {
        ...profile,
        completion: {
          ...profile.completion,
          workingLocator: { segments: ['[role="article"]'] }
        }
      },
      copilotWorkingTrace
    );
    expect(result.reasons).toContain(
      'Working selector remains active in the final state.'
    );
  });
});
