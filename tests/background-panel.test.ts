import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onClicked: vi.fn(),
  onActivated: vi.fn(),
  onPanelState: vi.fn(),
  query: vi.fn(),
  onUpdated: vi.fn(),
  sendMessage: vi.fn(),
  executeScript: vi.fn(),
  updateRoverRegistration: vi.fn()
}));

vi.mock('../src/background/socket', () => ({
  disableRoverConnection: vi.fn(),
  enableRoverConnection: vi.fn(),
  isRoverConnectionEnabled: () => true,
  updateRoverRegistration: mocks.updateRoverRegistration
}));
vi.mock('../src/background/messages', () => ({
  installMessageHandler: vi.fn(),
  syncDebugSubscription: vi.fn(async () => undefined)
}));
vi.mock('../src/background/debug-logging', () => ({
  initializeDebugLogging: vi.fn(),
  debugLog: vi.fn()
}));

describe('badge restoration after navigation', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.sendMessage.mockImplementation(async (_tabId, message) =>
      message.type === 'ROVER_TOGGLE_PANEL' ? { open: true } : { ok: true }
    );
    mocks.executeScript.mockResolvedValue([]);
    mocks.query.mockResolvedValue([{ id: 7 }]);
    mocks.updateRoverRegistration.mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
      tabs: {
        query: mocks.query,
        sendMessage: mocks.sendMessage,
        onActivated: { addListener: mocks.onActivated },
        onUpdated: { addListener: mocks.onUpdated }
      },
      scripting: { executeScript: mocks.executeScript },
      runtime: { onMessage: { addListener: mocks.onPanelState } },
      action: { onClicked: { addListener: mocks.onClicked } }
    });
    await import('../src/background');
    await mocks.onClicked.mock.calls[0]![0]({ id: 7, url: 'https://claude.ai/chat/1' });
    mocks.sendMessage.mockClear();
    mocks.updateRoverRegistration.mockClear();
  });

  it('keeps the panel attached when a result tab opens and preserves its expanded state on return', async () => {
    mocks.onPanelState.mock.calls[0]![0](
      { type: 'ROVER_PANEL_STATE', expanded: true },
      { tab: { id: 7 } }
    );
    mocks.query.mockResolvedValue([{ id: 8 }]);
    mocks.onActivated.mock.calls[0]![0]({ tabId: 8 });
    await vi.waitFor(() => expect(mocks.updateRoverRegistration).toHaveBeenCalledWith(8));
    expect(mocks.sendMessage).not.toHaveBeenCalledWith(7, { type: 'ROVER_HIDE_PANEL' });
    mocks.query.mockResolvedValue([{ id: 7 }]);
    mocks.onActivated.mock.calls[0]![0]({ tabId: 7 });
    await vi.waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith(7, {
        type: 'ROVER_ENSURE_PANEL',
        expanded: true
      })
    );
  });

  it('restores the badge when returning to a chat that navigated while the result tab was active', async () => {
    mocks.query.mockResolvedValue([{ id: 8 }]);
    mocks.onActivated.mock.calls[0]![0]({ tabId: 8 });
    mocks.onUpdated.mock.calls[0]![0](7, { status: 'complete' });
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalled());
    mocks.sendMessage.mockClear();
    mocks.sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist.'));
    mocks.query.mockResolvedValue([{ id: 7 }]);
    mocks.onActivated.mock.calls[0]![0]({ tabId: 7 });
    await vi.waitFor(() =>
      expect(mocks.executeScript).toHaveBeenCalledWith({
        target: { tabId: 7 },
        files: ['content.js']
      })
    );
    expect(mocks.sendMessage).toHaveBeenCalledWith(7, {
      type: 'ROVER_ENSURE_PANEL',
      expanded: false
    });
  });

  it('still removes the previous panel when the toolbar explicitly opens Rover on another tab', async () => {
    await mocks.onClicked.mock.calls[0]![0]({ id: 8, url: 'https://claude.ai/chat/2' });
    expect(mocks.sendMessage).toHaveBeenCalledWith(7, { type: 'ROVER_HIDE_PANEL' });
    expect(mocks.sendMessage).toHaveBeenCalledWith(8, { type: 'ROVER_TOGGLE_PANEL' });
  });

  it('does not restore a panel explicitly closed through the toolbar', async () => {
    mocks.sendMessage.mockResolvedValueOnce({ open: false });
    await mocks.onClicked.mock.calls[0]![0]({ id: 7, url: 'https://claude.ai/chat/1' });
    mocks.sendMessage.mockClear();
    mocks.onActivated.mock.calls[0]![0]({ tabId: 8 });
    mocks.onActivated.mock.calls[0]![0]({ tabId: 7 });
    await vi.waitFor(() => expect(mocks.updateRoverRegistration).toHaveBeenCalledWith(7));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('restores the badge when registration fails', async () => {
    mocks.updateRoverRegistration.mockRejectedValue(new Error('Endpoint unavailable'));
    mocks.onUpdated.mock.calls[0]![0](7, { status: 'complete' });

    await vi.waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith(7, {
        type: 'ROVER_ENSURE_PANEL',
        expanded: false
      })
    );
  });

  it('restores the badge while registration is waiting on the queue', async () => {
    let finishRegistration!: () => void;
    mocks.updateRoverRegistration.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRegistration = resolve;
        })
    );
    mocks.onUpdated.mock.calls[0]![0](7, { status: 'complete' });

    try {
      await vi.waitFor(() =>
        expect(mocks.sendMessage).toHaveBeenCalledWith(7, {
          type: 'ROVER_ENSURE_PANEL',
          expanded: false
        })
      );
    } finally {
      finishRegistration();
    }
  });

  it('does not inject the badge into a different tab that finishes loading', async () => {
    mocks.onUpdated.mock.calls[0]![0](8, { status: 'complete' });
    await vi.waitFor(() => expect(mocks.updateRoverRegistration).toHaveBeenCalledWith(8));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.executeScript).not.toHaveBeenCalled();
  });

  it('reinjects the content script before restoring the badge on a fresh document', async () => {
    mocks.sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist.'));
    mocks.onUpdated.mock.calls[0]![0](7, { status: 'complete' });

    await vi.waitFor(() =>
      expect(mocks.executeScript).toHaveBeenCalledWith({
        target: { tabId: 7 },
        files: ['content.js']
      })
    );
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(2));
  });
});
