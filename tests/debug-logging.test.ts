import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEBUG_LOGGING_KEY,
  debugLog,
  getDebugLogging,
  initializeDebugLogging,
  setDebugLogging,
  setDebugLoggingEnabled
} from '../src/background/debug-logging';

const originalChrome = globalThis.chrome;

afterEach(() => {
  globalThis.chrome = originalChrome;
  vi.restoreAllMocks();
});

function installChrome(storedValue?: unknown) {
  const listener = vi.fn();
  const local = {
    get: vi.fn(async () => ({ [DEBUG_LOGGING_KEY]: storedValue })),
    set: vi.fn(async () => undefined)
  };
  globalThis.chrome = {
    storage: {
      local,
      onChanged: { addListener: listener }
    }
  } as unknown as typeof chrome;
  return { listener, local };
}

describe('debug logging preference', () => {
  it('defaults to disabled when storage has no value', async () => {
    installChrome();

    await expect(getDebugLogging()).resolves.toBe(false);
  });

  it('reads only an explicit true value as enabled', async () => {
    installChrome(true);

    await expect(getDebugLogging()).resolves.toBe(true);
  });

  it('persists the preference in local storage', async () => {
    const { local } = installChrome();

    await setDebugLogging(true);

    expect(local.set).toHaveBeenCalledWith({ [DEBUG_LOGGING_KEY]: true });
  });

  it('suppresses debug output when disabled', () => {
    installChrome();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    setDebugLoggingEnabled(false);

    debugLog('hidden', { value: 1 });

    expect(info).not.toHaveBeenCalled();
  });

  it('emits the existing debug format when enabled', () => {
    installChrome();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    setDebugLoggingEnabled(true);

    debugLog('visible', { value: 1 });

    expect(info).toHaveBeenCalledWith('[Rover debug] visible', { value: 1 });
  });

  it('updates the logger when storage changes', async () => {
    const { listener } = installChrome(false);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    setDebugLoggingEnabled(true);
    initializeDebugLogging();

    const changeListener = listener.mock.calls[0]?.[0] as (
      changes: Record<string, { newValue?: unknown }>,
      area: string
    ) => void;
    changeListener({ [DEBUG_LOGGING_KEY]: { newValue: false } }, 'local');
    debugLog('hidden-after-change');

    expect(info).not.toHaveBeenCalled();
  });
});
