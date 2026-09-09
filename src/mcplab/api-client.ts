import type { LiveTestCatalogItem, LiveTestCompletion, LiveTestSessionView } from './types';

export const DEFAULT_MCPLAB_ORIGIN = 'http://127.0.0.1:8787';

export function normalizeMcplabOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a valid MCPLab origin.');
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('MCPLab V1 supports loopback origins only.');
  }
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('MCPLab origin must contain only HTTP protocol, host, and port.');
  }
  return url.origin;
}

export class McplabApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export class McplabClient {
  readonly origin: string;

  constructor(origin: string, private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.origin = normalizeMcplabOrigin(origin);
  }

  async listTestCases(): Promise<LiveTestCatalogItem[]> {
    const value = await this.request<{ testCases: LiveTestCatalogItem[] }>('/api/live-tests/test-cases');
    if (!Array.isArray(value.testCases)) throw new McplabApiError('MCPLab returned an invalid test-case catalog.');
    return value.testCases;
  }

  start(testCaseId: string, client: string, evaluationGroupId?: string): Promise<LiveTestSessionView> {
    return this.request('/api/live-tests/sessions', {
      method: 'POST',
      body: JSON.stringify({ testCaseId, client, evaluationGroupId })
    });
  }

  get(sessionId: string): Promise<LiveTestSessionView> {
    return this.request(`/api/live-tests/sessions/${encodeURIComponent(sessionId)}`);
  }

  complete(sessionId: string, input: { finalText: string; startedAt: string; completedAt: string }): Promise<LiveTestCompletion> {
    return this.request(`/api/live-tests/sessions/${encodeURIComponent(sessionId)}/complete`, {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  cancel(sessionId: string): Promise<LiveTestSessionView> {
    return this.request(`/api/live-tests/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.origin}${path}`, {
        ...init,
        headers: {
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers
        }
      });
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
      throw new McplabApiError(`Could not connect to MCPLab at ${this.origin}.${detail}`);
    }
    const value = await response.json().catch(() => null) as { error?: unknown } | null;
    if (!response.ok) {
      throw new McplabApiError(typeof value?.error === 'string' ? value.error : `MCPLab request failed (${response.status}).`, response.status);
    }
    if (!value || typeof value !== 'object') throw new McplabApiError('MCPLab returned an invalid response.');
    return value as T;
  }
}
