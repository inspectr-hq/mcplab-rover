import { describe, expect, it } from 'vitest';
import { scoreAssistantCandidate, selectAssistantCandidate, type ChatCandidateDescriptor } from '../src/providers/candidate-descriptor';

const candidate = (overrides: Partial<ChatCandidateDescriptor>): ChatCandidateDescriptor => ({
  tagName: 'DIV',
  text: 'A useful assistant response with enough content.',
  visible: true,
  changed: true,
  ...overrides
});

describe('generic chat candidate scoring', () => {
  it('prefers Copilot response metadata over user-message metadata', () => {
    const selected = selectAssistantCandidate([
      candidate({ testId: 'chatQuestion', changed: true, text: 'hello' }),
      candidate({ testId: 'markdown-reply', changed: true })
    ]);
    expect(selected?.testId).toBe('markdown-reply');
  });

  it('recognizes Claude and TrendMiner response semantics without provider IDs', () => {
    expect(scoreAssistantCandidate(candidate({ className: 'font-claude-response' }))).toBeGreaterThan(0);
    expect(scoreAssistantCandidate(candidate({ dataTest: 'chat-messages_message', className: 'chat-messages__message--assistant' }))).toBeGreaterThan(0);
  });

  it('rejects hidden and control elements', () => {
    expect(scoreAssistantCandidate(candidate({ visible: false }))).toBe(Number.NEGATIVE_INFINITY);
    expect(scoreAssistantCandidate(candidate({ tagName: 'BUTTON', testId: 'CopyButtonTestId' }))).toBeLessThan(0);
  });
});
