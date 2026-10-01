export function selectMatchingExecutionTab(
  expectedProvider: string,
  bound: { id: number; provider?: string },
  active?: { id: number; provider?: string }
): number | undefined {
  if (bound.provider === expectedProvider) return bound.id;
  if (active?.provider === expectedProvider) return active.id;
  return undefined;
}
