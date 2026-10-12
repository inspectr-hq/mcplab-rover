export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

export function unsupportedNewConversationError(providerName: string): Error & { code: string } {
  return Object.assign(
    new Error(
      `${providerName} has no New Chat support. Choose Continue the same conversation or learn a New Chat action.`
    ),
    { code: 'new_conversation_unsupported' }
  );
}
