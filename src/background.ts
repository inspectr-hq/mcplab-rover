import { installMessageHandler, syncDebugSubscription } from './background/messages';
import { connectToMcplab, updateRoverRegistration } from './background/socket';

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void updateRoverRegistration(tabId).catch((error) =>
    console.warn('[Rover] tab activation registration failed', error)
  );
  void syncDebugSubscription(tabId).catch((error) =>
    console.warn('[Rover] debug subscription sync failed', error)
  );
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    void updateRoverRegistration(tabId).catch((error) =>
      console.warn('[Rover] tab update registration failed', error)
    );
    void syncDebugSubscription(tabId).catch((error) =>
      console.warn('[Rover] debug subscription sync failed', error)
    );
  }
});

void connectToMcplab().catch(() => undefined);
installMessageHandler();

chrome.action.onClicked.addListener(async (tab) => {
  if (typeof tab.id !== 'number') return;
  try {
    await connectToMcplab().catch(() => undefined);
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'ROVER_TOGGLE_PANEL' });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'ROVER_TOGGLE_PANEL' });
    }
  } catch {
    // Chrome internal pages and restricted frames do not allow injection.
  }
});
