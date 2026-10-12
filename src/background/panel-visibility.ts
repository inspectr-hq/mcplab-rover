export function shouldRestorePanelAfterNavigation(input: {
  connectionEnabled: boolean;
  panelTabId: number | undefined;
  activeTabId: number | undefined;
  provider: string | undefined;
}): boolean {
  return (
    input.connectionEnabled &&
    input.panelTabId !== undefined &&
    input.panelTabId === input.activeTabId
  );
}

export function shouldHidePreviousPanel(input: {
  panelTabId: number | undefined;
  activeTabId: number | undefined;
}): boolean {
  return input.panelTabId !== undefined && input.panelTabId !== input.activeTabId;
}

export function shouldRestorePanelExpanded(expanded: boolean | undefined): boolean {
  return expanded === true;
}
