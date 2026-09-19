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
  console.info('[Rover debug] toolbar clicked', { tabId: tab.id, url: tab.url });
  try {
    await connectToMcplab().catch(() => undefined);
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'ROVER_SHOW_PANEL' });
      console.info('[Rover debug] panel shown in existing content script', { tabId: tab.id });
    } catch (error) {
      console.info('[Rover debug] content script unavailable, injecting panel host', {
        tabId: tab.id,
        error: error instanceof Error ? error.message : String(error)
      });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'ROVER_SHOW_PANEL' });
      console.info('[Rover debug] panel shown after content script injection', { tabId: tab.id });
    }
  } catch (error) {
    console.warn('[Rover] could not show panel in active tab', {
      tabId: tab.id,
      url: tab.url,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
