import type { ProviderId } from '../contracts';

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
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
