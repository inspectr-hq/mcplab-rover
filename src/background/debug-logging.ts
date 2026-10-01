export const DEBUG_LOGGING_KEY = 'rover.debugLogging';

let debugLoggingEnabled = false;
let storageListenerInstalled = false;

export async function getDebugLogging(): Promise<boolean> {
  const stored = (await chrome.storage.local.get(DEBUG_LOGGING_KEY))[DEBUG_LOGGING_KEY];
  return stored === true;
}

export async function setDebugLogging(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [DEBUG_LOGGING_KEY]: enabled });
  setDebugLoggingEnabled(enabled);
}

export function setDebugLoggingEnabled(enabled: boolean): void {
  debugLoggingEnabled = enabled;
}

export function initializeDebugLogging(): void {
  if (!storageListenerInstalled) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !(DEBUG_LOGGING_KEY in changes)) return;
      setDebugLoggingEnabled(changes[DEBUG_LOGGING_KEY].newValue === true);
    });
    storageListenerInstalled = true;
  }
  void getDebugLogging().then(setDebugLoggingEnabled);
}

export function debugLog(event: string, details: Record<string, unknown> = {}): void {
  if (!debugLoggingEnabled) return;
  console.info(`[Rover debug] ${event}`, details);
}
