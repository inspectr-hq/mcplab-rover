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
});
