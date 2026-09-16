import type { ProviderId } from '../contracts';

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
}

export function expectedProviderForUrl(url?: string): ProviderId | undefined {
  if (!url) return undefined;
  try {
    const hostname = new URL(url).hostname;
    if (hostname === 'claude.ai') return 'claude';
    if (hostname === 'trendminer.net' || hostname.endsWith('.trendminer.net')) return 'trendminer';
  } catch {
    return undefined;
  }
  return undefined;
}

export async function detectProvider(tabId: number): Promise<ProviderId | undefined> {
  const retryDelaysMs = [300, 600, 1_200, 2_000];
  let lastError: string | undefined;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      try {
        const provider =
          (await chrome.tabs.sendMessage(tabId, { type: 'ROVER_DETECT' })) ?? undefined;
        if (provider) {
          detectionDiagnostics.set(tabId, {
            attempts: attempt + 1,
            provider,
            checkedAt: new Date().toISOString()
          });
          return provider;
        }
      } catch {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        const provider =
          (await chrome.tabs.sendMessage(tabId, { type: 'ROVER_DETECT' })) ?? undefined;
        if (provider) {
          detectionDiagnostics.set(tabId, {
            attempts: attempt + 1,
            provider,
            checkedAt: new Date().toISOString()
          });
          return provider;
        }
      }
    } catch (error) {
      // The page may still be loading or temporarily unavailable.
      lastError = error instanceof Error ? error.message : String(error);
    }
    const retryDelay = retryDelaysMs[attempt];
    if (retryDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }
  detectionDiagnostics.set(tabId, {
    attempts: retryDelaysMs.length + 1,
    checkedAt: new Date().toISOString(),
    error: lastError
  });
  return undefined;
}

export interface DetectionDiagnostics {
  attempts: number;
  checkedAt: string;
  provider?: ProviderId;
  error?: string;
}

const detectionDiagnostics = new Map<number, DetectionDiagnostics>();

export function getDetectionDiagnostics(tabId: number): DetectionDiagnostics | undefined {
  return detectionDiagnostics.get(tabId);
}
