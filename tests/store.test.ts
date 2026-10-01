import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORIGIN_KEY, resolveOrigin } from '../src/background/store';

const originalChrome = globalThis.chrome;

afterEach(() => {
  globalThis.chrome = originalChrome;
});

describe('resolveOrigin', () => {
  it('does not rewrite an unchanged origin to sync storage', async () => {
    const set = vi.fn(async () => undefined);
    globalThis.chrome = {
      storage: {
        sync: {
          get: vi.fn(async () => ({ [ORIGIN_KEY]: 'http://127.0.0.1:8787' })),
          set
        }
      }
    } as unknown as typeof chrome;

    await expect(resolveOrigin()).resolves.toBe('http://127.0.0.1:8787');
    expect(set).not.toHaveBeenCalled();
  });

  it('persists a changed origin once', async () => {
    const set = vi.fn(async () => undefined);
    globalThis.chrome = {
      storage: {
        sync: {
          get: vi.fn(async () => ({ [ORIGIN_KEY]: 'http://127.0.0.1:8787' })),
          set
        }
      }
    } as unknown as typeof chrome;

    await resolveOrigin('http://localhost:9000');
    expect(set).toHaveBeenCalledWith({ [ORIGIN_KEY]: 'http://localhost:9000' });
  });
});
