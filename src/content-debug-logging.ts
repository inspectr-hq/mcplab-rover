const DEBUG_LOGGING_KEY = 'rover.debugLogging';

let debugLoggingEnabled = false;
let storageListenerInstalled = false;

function setDebugLoggingEnabled(enabled: boolean): void {
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
  void chrome.storage.local
    .get(DEBUG_LOGGING_KEY)
    .then((stored) => setDebugLoggingEnabled(stored[DEBUG_LOGGING_KEY] === true));
}

export function debugLog(event: string, details: Record<string, unknown> = {}): void {
  if (!debugLoggingEnabled) return;
  console.info(`[Rover debug] ${event}`, details);
}
