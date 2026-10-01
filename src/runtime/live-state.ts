export function acceptsContentResult(
  state: { requestId: string; sessionId?: string },
  result: { requestId: string; sessionId: string }
): boolean {
  return state.requestId === result.requestId && state.sessionId === result.sessionId;
}
