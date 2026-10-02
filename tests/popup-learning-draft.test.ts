// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BrowserProviderDiscoveryDraft } from '../src/contracts';

const draft: BrowserProviderDiscoveryDraft = {
  profile: {
    schemaVersion: 1,
    id: 'claude',
    name: 'Claude',
    match: { origins: ['https://claude.ai'] },
    composer: { locator: { segments: ['textarea'] }, inputMode: 'textarea' },
    submit: { action: 'enter' },
    assistantMessages: { locator: { segments: ['article'] } },
    completion: { stabilityMs: 2500 },
    learned: {
      sourceOrigin: 'https://claude.ai',
      createdAt: '2026-10-02T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
      confidence: {}
    }
  },
  sourceUrl: 'https://claude.ai/chat/saved',
  readyToSave: true,
  capabilities: [{ id: 'composer', label: 'Composer', confidence: 'high', detail: 'Found input.' }]
};

beforeEach(() => {
  vi.resetModules();
  document.documentElement.innerHTML = readFileSync('rover.html', 'utf8');
});

afterEach(() => vi.unstubAllGlobals());

async function openPopup(key: string, savedDraft = draft) {
  let resolveDetection!: (value: { url?: string }) => void;
  let onMessage!: (message: { type: string }) => void;
  const detection = new Promise((resolve) => {
    resolveDetection = resolve;
  });
  const sendMessage = vi.fn(async (message) => {
    if (message.type === 'ROVER_GET_ACTIVE_PROVIDER') return detection;
    return null;
  });
  const stored = { [key]: savedDraft };
  const remove = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: (listener: typeof onMessage) => {
          onMessage = listener;
        }
      }
    },
    storage: {
      local: { get: vi.fn(async () => stored), set: vi.fn(), remove },
      onChanged: { addListener: vi.fn() }
    }
  });
  await import('../src/popup/main');
  return { resolveDetection, sendMessage, onMessage, remove };
}

it.each(['rover.provider-discovery-draft', 'rover.learning-draft'])(
  'does not restore %s on a different website or before the page is known',
  async (key) => {
    const popup = await openPopup(key);
    expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(true);
    popup.resolveDetection({ url: 'https://polo.example/app' });
    await vi.waitFor(() =>
      expect(document.querySelector('#provider')?.textContent).toBe(
        'No supported chat detected on this tab'
      )
    );
    expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#learn-save')!.hidden).toBe(true);
    expect(document.querySelector('#learn-capabilities')!.children).toHaveLength(0);
    expect(document.querySelector('#learn-status')?.textContent).not.toContain(
      'saved learning draft'
    );
    expect(popup.remove).not.toHaveBeenCalled();
  }
);

it.each([draft, { ...draft, sourceUrl: undefined }])(
  'restores a matching saved draft, including legacy drafts without a source URL',
  async (savedDraft) => {
    const popup = await openPopup('rover.provider-discovery-draft', savedDraft);
    popup.resolveDetection({ url: 'https://claude.ai/new' });
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>('#learn-name')!.value).toBe('Claude')
    );
    expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('#learn-save')!.hidden).toBe(false);
    expect(document.querySelector('#learn-status')?.textContent).toBe(
      'A saved learning draft is ready to review.'
    );
  }
);

it('hides a displayed draft when the active page changes to a different website', async () => {
  const popup = await openPopup('rover.provider-discovery-draft');
  popup.resolveDetection({ url: 'https://claude.ai/new' });
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(false)
  );
  popup.sendMessage.mockResolvedValueOnce({ url: 'https://polo.example/app' });
  popup.onMessage({ type: 'ROVER_ACTIVE_PROVIDER_CHANGED' });
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(true)
  );
  expect(document.querySelector<HTMLButtonElement>('#learn-save')!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>('#learn-evidence-section')!.hidden).toBe(true);
  expect(popup.remove).not.toHaveBeenCalled();
});
