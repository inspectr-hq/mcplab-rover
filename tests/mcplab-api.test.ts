import { describe, expect, it, vi } from 'vitest';
import { McplabClient, normalizeMcplabOrigin } from '../src/mcplab/api-client';

describe('normalizeMcplabOrigin', () => {
  it('accepts loopback HTTP origins and removes trailing slashes', () => {
    expect(normalizeMcplabOrigin(' http://127.0.0.1:8787/ ')).toBe('http://127.0.0.1:8787');
    expect(normalizeMcplabOrigin('http://localhost:9000')).toBe('http://localhost:9000');
  });

  it('rejects paths and remote hosts', () => {
    expect(() => normalizeMcplabOrigin('http://127.0.0.1:8787/api')).toThrow('origin');
    expect(() => normalizeMcplabOrigin('https://example.com')).toThrow('loopback');
  });
});

describe('McplabClient', () => {
  it('loads the Live Test catalog', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ testCases: [{ id: 'one' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new McplabClient('http://127.0.0.1:8787', fetcher as typeof fetch);
    const result = await client.listTestCases();
    expect(result[0]?.id).toBe('one');
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:8787/api/live-tests/test-cases', expect.any(Object));
  });

  it('loads declarative browser providers', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ providers: [{ id: 'custom', schemaVersion: 1 }] }), { status: 200 }));
    const client = new McplabClient('http://127.0.0.1:8787', fetcher as typeof fetch);
    const result = await client.listBrowserProviders();
    expect(result[0]?.id).toBe('custom');
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:8787/api/rover/providers', expect.any(Object));
  });

  it('passes queued run metadata when starting a Live Test session', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'session-1' }), { status: 201 }));
    const client = new McplabClient('http://127.0.0.1:8787', fetcher as typeof fetch);
    await client.start('case-1', 'm365.cloud.microsoft', 'evaluation-1', {
      configPath: 'evals/hi-there.yaml',
      configName: 'Hi There',
      agentName: 'm365.cloud.microsoft'
    });
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/live-tests/sessions',
      expect.objectContaining({
        body: JSON.stringify({
          testCaseId: 'case-1',
          client: 'm365.cloud.microsoft',
          evaluationRunId: 'evaluation-1',
          configPath: 'evals/hi-there.yaml',
          configName: 'Hi There',
          agentName: 'm365.cloud.microsoft'
        })
      })
    );
  });
});
