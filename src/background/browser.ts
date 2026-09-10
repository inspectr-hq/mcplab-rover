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
  try {
    try {
      return (await chrome.tabs.sendMessage(tabId, { type: 'ROVER_DETECT' })) ?? undefined;
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return (await chrome.tabs.sendMessage(tabId, { type: 'ROVER_DETECT' })) ?? undefined;
    }
  } catch {
    return undefined;
  }
}
