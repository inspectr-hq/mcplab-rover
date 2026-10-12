import { installMessageHandler, syncDebugSubscription } from './background/messages';
import {
  disableRoverConnection,
  enableRoverConnection,
  isRoverConnectionEnabled,
  updateRoverRegistration
} from './background/socket';
import {
  shouldHidePreviousPanel,
  shouldRestorePanelExpanded,
  shouldRestorePanelAfterNavigation
} from './background/panel-visibility';
import { debugLog, initializeDebugLogging } from './background/debug-logging';

initializeDebugLogging();

let panelTabId: number | undefined;
const panelExpandedByTab = new Map<number, boolean>();

async function restorePanelForTab(tabId: number): Promise<void> {
  if (tabId !== panelTabId) return;
  const activeTab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (
    !shouldRestorePanelAfterNavigation({
      connectionEnabled: isRoverConnectionEnabled(),
      panelTabId,
      activeTabId: activeTab?.id,
      provider: undefined
    })
  )
    return;
  const message = {
    type: 'ROVER_ENSURE_PANEL',
    expanded: shouldRestorePanelExpanded(panelExpandedByTab.get(tabId))
  } as const;
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, message);
  }
  debugLog('panel restored in tracked tab', { tabId, expanded: message.expanded });
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void restorePanelForTab(tabId).catch((error) =>
    debugLog('panel restore skipped after tab activation', {
      tabId,
      error: error instanceof Error ? error.message : String(error)
    })
  );
  void updateRoverRegistration(tabId).catch((error) =>
    console.warn('[Rover] tab activation registration failed', error)
  );
  void syncDebugSubscription(tabId).catch((error) =>
    console.warn('[Rover] debug subscription sync failed', error)
  );
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    void restorePanelForTab(tabId).catch((error) =>
      debugLog('panel restore skipped after navigation', {
        tabId,
        error: error instanceof Error ? error.message : String(error)
      })
    );
    void updateRoverRegistration(tabId).catch((error) =>
      console.warn('[Rover] navigation registration failed', error)
    );
    void syncDebugSubscription(tabId).catch((error) =>
      console.warn('[Rover] debug subscription sync failed', error)
    );
  }
});

installMessageHandler();

chrome.runtime.onMessage.addListener((message: { type?: string; expanded?: boolean }, sender) => {
  if (message.type !== 'ROVER_PANEL_STATE' || typeof sender.tab?.id !== 'number') return;
  if (panelTabId === sender.tab.id)
    panelExpandedByTab.set(sender.tab.id, message.expanded === true);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (typeof tab.id !== 'number') return;
  debugLog('toolbar clicked', { tabId: tab.id, url: tab.url });
  try {
    if (shouldHidePreviousPanel({ panelTabId, activeTabId: tab.id })) {
      const previousPanelTabId = panelTabId!;
      await chrome.tabs
        .sendMessage(previousPanelTabId, { type: 'ROVER_HIDE_PANEL' })
        .catch(() => undefined);
      panelTabId = undefined;
      panelExpandedByTab.delete(previousPanelTabId);
    }
    let response: { open?: boolean } | undefined;
    try {
      response = (await chrome.tabs.sendMessage(tab.id, {
        type: 'ROVER_TOGGLE_PANEL'
      })) as { open?: boolean } | undefined;
      debugLog('panel shown in existing content script', { tabId: tab.id });
    } catch (error) {
      debugLog('content script unavailable, injecting panel host', {
        tabId: tab.id,
        error: error instanceof Error ? error.message : String(error)
      });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      response = (await chrome.tabs.sendMessage(tab.id, {
        type: 'ROVER_TOGGLE_PANEL'
      })) as { open?: boolean } | undefined;
      debugLog('panel shown after content script injection', { tabId: tab.id });
    }
    if (response?.open === true) {
      panelTabId = tab.id;
      panelExpandedByTab.set(tab.id, false);
      enableRoverConnection();
      await updateRoverRegistration(tab.id).catch((error) =>
        console.warn('[Rover] toolbar tab registration failed', error)
      );
    } else if (response?.open === false) {
      if (panelTabId === tab.id) panelTabId = undefined;
      panelExpandedByTab.delete(tab.id);
      await disableRoverConnection();
    }
  } catch (error) {
    console.warn('[Rover] could not show panel in active tab', {
      tabId: tab.id,
      url: tab.url,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
