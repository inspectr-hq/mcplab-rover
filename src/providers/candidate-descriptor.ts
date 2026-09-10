export interface ChatCandidateDescriptor {
  tagName: string;
  role?: string;
  testId?: string;
  dataTest?: string;
  ariaLabel?: string;
  className?: string;
  text: string;
  visible: boolean;
  changed: boolean;
  ancestorRoles?: string[];
}

export function scoreAssistantCandidate(candidate: ChatCandidateDescriptor): number {
  if (!candidate.visible || !candidate.text.trim()) return Number.NEGATIVE_INFINITY;
  const identity = `${candidate.testId ?? ''} ${candidate.dataTest ?? ''} ${candidate.ariaLabel ?? ''} ${candidate.className ?? ''}`.toLowerCase();
  const text = candidate.text.trim();
  let score = 0;
  if (/assistant|copilot-message|markdown-reply|response|reply|message-content/.test(identity)) score += 8;
  if (/user|question|prompt|loading|suggestion|feedback|copy|action|button/.test(identity)) score -= 10;
  if (candidate.role === 'article' || candidate.ancestorRoles?.includes('feed')) score += 3;
  if (candidate.testId || candidate.dataTest) score += 3;
  if (candidate.changed) score += 8;
  if (text.length >= 20) score += 2;
  if (text.length > 5000) score -= 2;
  if (candidate.tagName === 'BUTTON' || candidate.tagName === 'INPUT' || candidate.tagName === 'TEXTAREA') score -= 12;
  return score;
}

export function selectAssistantCandidate<T extends ChatCandidateDescriptor>(candidates: T[]): T | null {
  return candidates
    .map((candidate, index) => ({ candidate, score: scoreAssistantCandidate(candidate), index }))
    .sort((left, right) => right.score - left.score || right.index - left.index)[0]?.candidate ?? null;
}
