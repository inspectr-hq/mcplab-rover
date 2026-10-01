import { describe, expect, it } from 'vitest';
import {
  shouldHidePreviousPanel,
  shouldRestorePanelExpanded,
  shouldRestorePanelAfterNavigation
} from '../src/background/panel-visibility';

describe('panel visibility', () => {
  it('restores only for the active Rover tab with a detected provider', () => {
    expect(
      shouldRestorePanelAfterNavigation({
        connectionEnabled: true,
        panelTabId: 12,
        activeTabId: 12,
        provider: 'copilot-cloud-microsoft'
      })
    ).toBe(true);
  });

  it('does not restore on another tab or when Rover is disabled', () => {
    for (const input of [
      { connectionEnabled: true, panelTabId: 12, activeTabId: 13, provider: 'copilot' },
      { connectionEnabled: false, panelTabId: 12, activeTabId: 12, provider: 'copilot' }
    ])
      expect(shouldRestorePanelAfterNavigation(input)).toBe(false);
  });

  it('restores the active Rover panel before provider detection is ready', () => {
    expect(
      shouldRestorePanelAfterNavigation({
        connectionEnabled: true,
        panelTabId: 12,
        activeTabId: 12,
        provider: undefined
      })
    ).toBe(true);
  });

  it('hides the previous panel when Rover is explicitly opened on a different tab', () => {
    expect(shouldHidePreviousPanel({ panelTabId: 12, activeTabId: 13 })).toBe(true);
    expect(shouldHidePreviousPanel({ panelTabId: 12, activeTabId: 12 })).toBe(false);
    expect(shouldHidePreviousPanel({ panelTabId: undefined, activeTabId: 13 })).toBe(false);
  });

  it('preserves the last expanded state during navigation restore', () => {
    expect(shouldRestorePanelExpanded(true)).toBe(true);
    expect(shouldRestorePanelExpanded(false)).toBe(false);
    expect(shouldRestorePanelExpanded(undefined)).toBe(false);
  });
});
