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
  let resolveDetection!: (value: {
    url?: string;
    learningTabId?: number | null;
    tabId?: number;
  }) => void;
  let rejectDetection!: (reason: Error) => void;
  let onMessage!: (
    message: { type: string; draft?: BrowserProviderDiscoveryDraft },
    sender?: chrome.runtime.MessageSender
  ) => void;
  const detection = new Promise((resolve, reject) => {
    resolveDetection = resolve;
    rejectDetection = reject;
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
  return { resolveDetection, rejectDetection, sendMessage, onMessage, remove };
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

it.each(['returned', 'thrown'])(
  'shows %s proposal errors beside Improve and restores the button',
  async (failure) => {
    const popup = await openPopup('rover.provider-discovery-draft', {
      ...draft,
      readyToSave: false,
      trace: {
        observedGeneration: true,
        selectorValidation: {
          composer: { valid: true, matchCount: 1, visible: true },
          submit: { valid: true, matchCount: 1, visible: true },
          assistant: { valid: true, matchCount: 1, visible: true }
        },
        events: []
      }
    });
    popup.resolveDetection({ url: 'https://claude.ai/new' });
    const button = document.querySelector<HTMLButtonElement>('#learn-propose')!;
    await vi.waitFor(() => expect(button.hidden).toBe(false));
    let reject!: (reason: Error) => void;
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done, fail) => {
      resolve = done;
      reject = fail;
    });
    popup.sendMessage.mockImplementation(async (message) => {
      if (message.type === 'ROVER_LEARN_PROPOSE') return pending;
      return null;
    });
    button.click();
    button.click();
    const status = document.querySelector<HTMLElement>('#learn-propose-status');
    expect(status).not.toBeNull();
    expect(status!.hidden).toBe(false);
    expect(status!.textContent).toContain('Asking MCPLab');
    expect(button.textContent).toContain('Reviewing');
    expect(button.disabled).toBe(true);
    expect(
      popup.sendMessage.mock.calls.filter(([message]) => message.type === 'ROVER_LEARN_PROPOSE')
    ).toHaveLength(1);
    const error = 'Unexpected token in the proposal JSON';
    if (failure === 'returned') resolve({ ok: false, error });
    else reject(new Error(error));
    await vi.waitFor(() => expect(status!.textContent).toBe(error));
    expect(document.querySelector('#learn-status')!.textContent).not.toBe(error);
    expect(status!.getAttribute('role')).toBe('status');
    expect(button.nextElementSibling).toBe(status);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Improve with MCPLab AI');
    expect(document.querySelector<HTMLButtonElement>('#learn-save')!.hidden).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('#learn-save')!.disabled).toBe(true);
  }
);

it.each([true, false])(
  'shows replay feedback and gates saving on its result (%s)',
  async (passed) => {
    const popup = await openPopup('rover.provider-discovery-draft', {
      ...draft,
      readyToSave: false,
      trace: {
        observedGeneration: true,
        selectorValidation: {
          composer: { valid: true, matchCount: 1, visible: true },
          submit: { valid: true, matchCount: 1, visible: true },
          assistant: { valid: true, matchCount: 1, visible: true }
        },
        events: []
      }
    });
    popup.resolveDetection({ url: 'https://claude.ai/new' });
    const button = document.querySelector<HTMLButtonElement>('#learn-propose')!;
    await vi.waitFor(() => expect(button.hidden).toBe(false));
    popup.sendMessage.mockImplementation(async (message) => {
      if (message.type === 'ROVER_LEARN_PROPOSE')
        return { ok: true, proposal: { profile: draft.profile, rationale: [], warnings: [] } };
      if (message.type === 'ROVER_LEARN_VALIDATE')
        return {
          ok: true,
          validation: { passed, reasons: passed ? [] : ['Response locator missing.'] }
        };
      return null;
    });
    button.click();
    await vi.waitFor(() =>
      expect(document.querySelector('#learn-propose-status')?.textContent).toBe(
        passed
          ? 'MCPLab proposal validated. Review and save the provider.'
          : 'MCPLab proposal rejected by browser replay. Response locator missing.'
      )
    );
    expect(document.querySelector<HTMLButtonElement>('#learn-save')!.hidden).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('#learn-save')!.disabled).toBe(!passed);
  }
);


it('keeps Save visible with the validation reason and enables it when learning passes', async () => {
  const reason = 'New Chat context change was not observed during learning.';
  const blockedDraft: BrowserProviderDiscoveryDraft = {
    ...draft,
    profile: {
      ...draft.profile,
      newConversation: {
        action: 'click',
        locator: { segments: ['button[title="New chat"]'] },
        confirmation: 'context-change'
      }
    },
    readyToSave: false,
    validationReasons: [reason]
  };
  const popup = await openPopup('rover.provider-discovery-draft', blockedDraft);
  popup.resolveDetection({ url: 'https://claude.ai/new' });
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(false)
  );
  const save = document.querySelector<HTMLButtonElement>('#learn-save')!;
  const explanation = document.querySelector<HTMLElement>('#learn-save-status');
  expect(save.hidden).toBe(false);
  expect(save.disabled).toBe(true);
  expect(explanation).not.toBeNull();
  expect(explanation!.hidden).toBe(false);
  expect(explanation!.textContent).toContain(reason);
  expect(explanation!.textContent).toContain('Open a new conversation on the provider page');
  expect(save.getAttribute('aria-describedby')).toBe(explanation!.id);
  save.click();
  expect(
    popup.sendMessage.mock.calls.some(([message]) => message.type === 'ROVER_LEARN_SAVE')
  ).toBe(false);
  popup.onMessage({ type: 'ROVER_LEARN_RESULT', draft });
  expect(save.hidden).toBe(false);
  expect(save.disabled).toBe(false);
  expect(explanation!.hidden).toBe(true);
});


it('preserves Stop learning when switching sites and restores the draft on return', async () => {
  const popup = await openPopup('rover.provider-discovery-draft');
  popup.resolveDetection({ url: 'https://claude.ai/new' });
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(false)
  );
  popup.onMessage({ type: 'ROVER_LEARN_RESULT', draft });
  const status = document.querySelector('#learn-status')!.textContent;
  popup.sendMessage.mockResolvedValueOnce({ url: 'https://polo.example/app' });
  popup.onMessage({ type: 'ROVER_ACTIVE_PROVIDER_CHANGED' });
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(true)
  );
  expect(document.querySelector('#learn-start')!.textContent).toBe('Stop learning');
  expect(document.querySelector('#learn-status')!.textContent).toBe(status);
  popup.sendMessage.mockResolvedValueOnce({ url: 'https://claude.ai/new' });
  popup.onMessage({ type: 'ROVER_ACTIVE_PROVIDER_CHANGED' });
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(false)
  );
  expect(document.querySelector('#learn-start')!.textContent).toBe('Stop learning');
  expect(document.querySelector<HTMLInputElement>('#learn-name')!.value).toBe('Claude');
});

it('restores a draft after an initial detection failure succeeds on retry', async () => {
  vi.useFakeTimers();
  try {
    const popup = await openPopup('rover.provider-discovery-draft');
    popup.rejectDetection(new Error('Content script loading'));
    await Promise.resolve();
    popup.sendMessage.mockResolvedValueOnce({ url: 'https://claude.ai/new' });
    await vi.advanceTimersByTimeAsync(500);
    expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('shows Stop learning when reopening Rover during a session in another tab', async () => {
  const popup = await openPopup('rover.provider-discovery-draft');
  popup.resolveDetection({ url: 'https://polo.example/app', learningTabId: 11 });
  await vi.waitFor(() =>
    expect(document.querySelector('#learn-start')!.textContent).toBe('Stop learning')
  );
  popup.sendMessage.mockResolvedValueOnce({ ok: true });
  document.querySelector<HTMLButtonElement>('#learn-start')!.click();
  await vi.waitFor(() =>
    expect(popup.sendMessage).toHaveBeenCalledWith({ type: 'ROVER_LEARN_STOP' })
  );
  expect(
    popup.sendMessage.mock.calls.some(([message]) => message.type === 'ROVER_LEARN_START')
  ).toBe(false);
});

it('keeps a late learning result from another site hidden until returning to that site', async () => {
  const popup = await openPopup('rover.provider-discovery-draft');
  popup.resolveDetection({ url: 'https://polo.example/app', tabId: 22 });
  await vi.waitFor(() =>
    expect(document.querySelector('#provider')!.textContent).toBe(
      'No supported chat detected on this tab'
    )
  );
  popup.onMessage(
    Object.assign(
      { type: 'ROVER_LEARN_PROGRESS' },
      {
        progress: {
          composerDetected: true,
          submitDetected: true,
          assistantDetected: true,
          generatingObserved: true,
          idleObserved: true
        }
      }
    ),
    { tab: { id: 11 } as chrome.tabs.Tab }
  );
  expect(document.querySelector<HTMLElement>('#learn-evidence-section')!.hidden).toBe(true);
  popup.onMessage({ type: 'ROVER_LEARN_RESULT', draft });
  expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('#learn-save')!.hidden).toBe(true);
  popup.sendMessage.mockResolvedValueOnce({ url: 'https://claude.ai/new' });
  popup.onMessage({ type: 'ROVER_ACTIVE_PROVIDER_CHANGED' });
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(false)
  );
});


it('does not replay or reveal an AI proposal when the user has switched to another site', async () => {
  const popup = await openPopup('rover.provider-discovery-draft', {
    ...draft,
    readyToSave: false,
    trace: {
      observedGeneration: true,
      selectorValidation: {
        composer: { valid: true, matchCount: 1, visible: true },
        submit: { valid: true, matchCount: 1, visible: true },
        assistant: { valid: true, matchCount: 1, visible: true }
      },
      events: []
    }
  });
  popup.resolveDetection({ url: 'https://claude.ai/new' });
  const button = document.querySelector<HTMLButtonElement>('#learn-propose')!;
  await vi.waitFor(() => expect(button.hidden).toBe(false));
  let resolve!: (value: unknown) => void;
  const pending = new Promise((done) => {
    resolve = done;
  });
  popup.sendMessage.mockImplementation(async (message) => {
    if (message.type === 'ROVER_LEARN_PROPOSE') return pending;
    if (message.type === 'ROVER_GET_ACTIVE_PROVIDER') return { url: 'https://polo.example/app' };
    return null;
  });
  button.click();
  popup.onMessage({ type: 'ROVER_ACTIVE_PROVIDER_CHANGED' });
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(true)
  );
  resolve({ ok: true, proposal: { profile: draft.profile, rationale: [], warnings: [] } });
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(
    popup.sendMessage.mock.calls.some(([message]) => message.type === 'ROVER_LEARN_VALIDATE')
  ).toBe(false);
  expect(document.querySelector<HTMLButtonElement>('#learn-save')!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>('#learn-propose-status')!.hidden).toBe(true);
});
