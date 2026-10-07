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

it.each([11, 22])('shows the learning instructions for the active tab %i', async (tabId) => {
  const popup = await openPopup('rover.provider-discovery-draft');
  popup.resolveDetection({ url: 'https://polo.example/app', tabId, learningTabId: 11 });
  await vi.waitFor(() =>
    expect(document.querySelector('#learn-start')!.textContent).toBe('Stop learning')
  );
  expect(document.querySelector('#learn-status')!.textContent).toBe(
    tabId === 11
      ? 'Learning is active. Follow the steps below in the chat.'
      : 'Learning is active. Return to the tab where learning started to continue, or stop learning here.'
  );
  const nextTabId = tabId === 11 ? 22 : 11;
  popup.sendMessage.mockResolvedValueOnce({
    url: 'https://polo.example/app',
    tabId: nextTabId,
    learningTabId: 11
  });
  popup.onMessage({ type: 'ROVER_ACTIVE_PROVIDER_CHANGED' });
  await vi.waitFor(() =>
    expect(document.querySelector('#learn-status')!.textContent).toBe(
      nextTabId === 11
        ? 'Learning is active. Follow the steps below in the chat.'
        : 'Learning is active. Return to the tab where learning started to continue, or stop learning here.'
    )
  );
});

it.each(['returned', 'success'])(
  'only removes the saved draft after a successful learning start (%s)',
  async (outcome) => {
    const popup = await openPopup('rover.provider-discovery-draft');
    popup.resolveDetection({ url: 'https://claude.ai/new', tabId: 11 });
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(false)
    );
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    popup.sendMessage.mockImplementation(async (message) => {
      if (message.type === 'ROVER_GET_ACTIVE_PROVIDER')
        return { url: 'https://claude.ai/new', tabId: 11, learningTabId: null };
      if (message.type === 'ROVER_GET_LEARN_TARGETS') return { targets: [] };
      if (message.type === 'ROVER_LEARN_START') return pending;
      return null;
    });
    const button = document.querySelector<HTMLButtonElement>('#learn-start')!;
    button.click();
    await vi.waitFor(() =>
      expect(popup.sendMessage).toHaveBeenCalledWith({
        type: 'ROVER_LEARN_START',
        targetProviderId: undefined
      })
    );
    const removedBeforeStart = popup.remove.mock.calls.length;
    resolve({ ok: outcome === 'success', error: 'Could not start learning.' });
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(removedBeforeStart).toBe(0);
    if (outcome === 'success') {
      expect(popup.remove).toHaveBeenCalledExactlyOnceWith([
        'rover.provider-discovery-draft',
        'rover.learning-draft'
      ]);
      expect(button.textContent).toBe('Stop learning');
    } else {
      expect(popup.remove).not.toHaveBeenCalled();
      expect(button.textContent).toBe('Start learning');
    }
  }
);


it.each([11, 22])('resets learning controls when the session is cleared from tab %i', async (tabId) => {
  const popup = await openPopup('rover.provider-discovery-draft');
  popup.resolveDetection({ url: 'https://polo.example/app', tabId, learningTabId: 11 });
  const button = document.querySelector<HTMLButtonElement>('#learn-start')!;
  const capture = document.querySelector<HTMLButtonElement>('#learn-capture')!;
  await vi.waitFor(() => expect(button.textContent).toBe('Stop learning'));
  expect(capture.hidden).toBe(false);

  popup.sendMessage.mockResolvedValueOnce({
    url: 'https://polo.example/app',
    tabId,
    learningTabId: null
  });
  popup.onMessage({ type: 'ROVER_ACTIVE_PROVIDER_CHANGED' });
  await vi.waitFor(() => expect(button.textContent).toBe('Start learning'));
  expect(capture.hidden).toBe(true);
  expect(document.querySelector('#learn-status')!.textContent).toBe(
    'Learning stopped. Start again when you are ready.'
  );
  expect(popup.remove).not.toHaveBeenCalled();
});

it('guides typing, sending and waiting using observed learning progress, then hides on Stop', async () => {
  const popup = await openPopup('unrelated-draft');
  popup.resolveDetection({ url: 'https://claude.ai/new', tabId: 11, learningTabId: 11 });
  const guide = document.querySelector<HTMLElement>('#learn-guide');
  await vi.waitFor(() => expect(guide?.hidden).toBe(false));
  const states = () => [...guide!.querySelectorAll('li')].map((step) => step.dataset.state);
  const progress = {
    composerDetected: false,
    submitDetected: false,
    assistantDetected: false,
    generatingObserved: false,
    idleObserved: false
  };
  const report = () =>
    popup.onMessage(Object.assign({ type: 'ROVER_LEARN_PROGRESS' }, { progress }), {
      tab: { id: 11 } as chrome.tabs.Tab
    });
  expect(states()).toEqual(['current', 'upcoming', 'upcoming']);
  expect(guide!.textContent).toContain('Step 1 of 3');
  progress.composerDetected = true;
  report();
  expect(states()).toEqual(['complete', 'current', 'upcoming']);
  expect(guide!.querySelector('[aria-current="step"]')?.textContent).toContain('Send the message');
  progress.submitDetected = true;
  report();
  expect(states()).toEqual(['complete', 'complete', 'current']);
  expect(guide!.textContent).toContain('Step 3 of 3');
  progress.assistantDetected = true;
  progress.idleObserved = true;
  report();
  expect(states()).toEqual(['complete', 'complete', 'current']);
  popup.onMessage({ type: 'ROVER_LEARN_RESULT', draft });
  expect(states()).toEqual(['complete', 'complete', 'complete']);
  expect(guide!.textContent).toContain('Response captured');
  expect(guide!.querySelector('[aria-current]')).toBeNull();
  progress.assistantDetected = false;
  progress.idleObserved = false;
  report();
  expect(document.querySelector<HTMLElement>('#learn-progress')!.hidden).toBe(true);
  expect(document.querySelector('#learn-capabilities')!.textContent).toContain('Found input.');
  expect(states()).toEqual(['complete', 'complete', 'complete']);
  popup.sendMessage.mockResolvedValueOnce({ ok: true });
  document.querySelector<HTMLButtonElement>('#learn-start')!.click();
  await vi.waitFor(() => expect(guide!.hidden).toBe(true));
});


const unconfirmedNewChatDraft: BrowserProviderDiscoveryDraft = {
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
  validationReasons: ['New Chat context change was not observed during Learning.'],
  trace: {
    observedGeneration: true,
    selectorValidation: {
      composer: { valid: true, matchCount: 1, visible: true },
      submit: { valid: true, matchCount: 1, visible: true },
      assistant: { valid: true, matchCount: 1, visible: true }
    },
    events: []
  }
};

it.each(['captured', 'AI proposal'])(
  'revalidates and saves a %s without the unconfirmed New Chat control',
  async (source) => {
    const savedDraft =
      source === 'captured'
        ? unconfirmedNewChatDraft
        : {
            ...unconfirmedNewChatDraft,
            capturedProfile: draft.profile,
            proposalDiagnostics: { rationale: ['Suggested New Chat.'], warnings: [] }
          };
    const popup = await openPopup('rover.provider-discovery-draft', savedDraft);
    popup.resolveDetection({ url: 'https://claude.ai/new' });
    const button = document.querySelector<HTMLButtonElement>('#learn-save-without-new-chat')!;
    await vi.waitFor(() => expect(button.hidden).toBe(false));
    popup.sendMessage.mockImplementation(async (message) => {
      if (message.type === 'ROVER_LEARN_VALIDATE')
        return { ok: true, validation: { passed: true, reasons: [] } };
      if (message.type === 'ROVER_LEARN_SAVE') return { ok: true };
      return null;
    });
    button.click();
    await vi.waitFor(() =>
      expect(document.querySelector('#learn-save-status')!.textContent).toContain(
        'Saved Claude to MCPLab without New Chat support.'
      )
    );
    const messages = popup.sendMessage.mock.calls.map(([message]) => message);
    const validation = messages.find((message) => message.type === 'ROVER_LEARN_VALIDATE');
    const save = messages.find((message) => message.type === 'ROVER_LEARN_SAVE');
    expect(validation.profile).not.toHaveProperty('newConversation');
    expect(save.profile).not.toHaveProperty('newConversation');
    expect(validation.trace).toEqual(savedDraft.trace);
    expect(messages.indexOf(validation)).toBeLessThan(messages.indexOf(save));
    expect(savedDraft.profile.newConversation).toBeDefined();
    expect(button.hidden).toBe(true);
    expect(popup.remove).toHaveBeenCalled();
  }
);

it.each(['validation', 'transport'])(
  'does not save without New Chat when %s fails and shows the error beside Save',
  async (failure) => {
    const popup = await openPopup('rover.provider-discovery-draft', unconfirmedNewChatDraft);
    popup.resolveDetection({ url: 'https://claude.ai/new' });
    const button = document.querySelector<HTMLButtonElement>('#learn-save-without-new-chat')!;
    await vi.waitFor(() => expect(button.hidden).toBe(false));
    popup.sendMessage.mockImplementation(async (message) => {
      if (message.type === 'ROVER_LEARN_VALIDATE') {
        if (failure === 'transport') throw new Error('Replay unavailable.');
        return { ok: true, validation: { passed: false, reasons: ['Response locator missing.'] } };
      }
      return null;
    });
    button.click();
    await vi.waitFor(() =>
      expect(document.querySelector('#learn-save-status')!.textContent).toContain(
        failure === 'transport' ? 'Replay unavailable.' : 'Response locator missing.'
      )
    );
    expect(
      popup.sendMessage.mock.calls.some(([message]) => message.type === 'ROVER_LEARN_SAVE')
    ).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('#learn-save')!.disabled).toBe(true);
    expect(popup.remove).not.toHaveBeenCalled();
  }
);

it('ignores a replay result after moving to a different website', async () => {
  const popup = await openPopup('rover.provider-discovery-draft', unconfirmedNewChatDraft);
  popup.resolveDetection({ url: 'https://claude.ai/new' });
  const button = document.querySelector<HTMLButtonElement>('#learn-save-without-new-chat')!;
  await vi.waitFor(() => expect(button.hidden).toBe(false));
  let resolve!: (value: unknown) => void;
  const pending = new Promise((done) => {
    resolve = done;
  });
  popup.sendMessage.mockImplementation(async (message) => {
    if (message.type === 'ROVER_LEARN_VALIDATE') return pending;
    if (message.type === 'ROVER_GET_ACTIVE_PROVIDER') return { url: 'https://polo.example/app' };
    return null;
  });
  button.click();
  popup.onMessage({ type: 'ROVER_ACTIVE_PROVIDER_CHANGED' });
  await vi.waitFor(() => expect(button.hidden).toBe(true));
  resolve({ ok: true, validation: { passed: true, reasons: [] } });
  await new Promise((done) => setTimeout(done, 0));
  expect(
    popup.sendMessage.mock.calls.some(([message]) => message.type === 'ROVER_LEARN_SAVE')
  ).toBe(false);
});

it('retains the validated profile without New Chat for retry after a save failure', async () => {
  const popup = await openPopup('rover.provider-discovery-draft', unconfirmedNewChatDraft);
  popup.resolveDetection({ url: 'https://claude.ai/new' });
  const button = document.querySelector<HTMLButtonElement>('#learn-save-without-new-chat')!;
  await vi.waitFor(() => expect(button.hidden).toBe(false));
  popup.sendMessage.mockImplementation(async (message) => {
    if (message.type === 'ROVER_LEARN_VALIDATE')
      return { ok: true, validation: { passed: true, reasons: [] } };
    if (message.type === 'ROVER_LEARN_SAVE') return { ok: false, error: 'MCPLab disconnected.' };
    return null;
  });
  button.click();
  await vi.waitFor(() =>
    expect(document.querySelector('#learn-save-status')!.textContent).toBe('MCPLab disconnected.')
  );
  const save = document.querySelector<HTMLButtonElement>('#learn-save')!;
  expect(save.disabled).toBe(false);
  expect(button.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>('#learn-proposal-section')!.hidden).toBe(true);
  expect(popup.remove).not.toHaveBeenCalled();
  popup.sendMessage.mockImplementation(async (message) => {
    if (message.type === 'ROVER_LEARN_SAVE') return { ok: true };
    return null;
  });
  save.click();
  await vi.waitFor(() => expect(popup.remove).toHaveBeenCalled());
  const saves = popup.sendMessage.mock.calls.filter(
    ([message]) => message.type === 'ROVER_LEARN_SAVE'
  );
  expect(saves).toHaveLength(2);
  expect(saves[1][0].profile).not.toHaveProperty('newConversation');
});


it.each([0, 1, 2])('only shows the learning target when choosing or updating a provider (%s)', async (count) => {
  const targets = [{ id: 'claude', name: 'Claude' }, { id: 'other', name: 'Other' }].slice(0, count);
  const popup = await openPopup('rover.provider-discovery-draft');
  popup.resolveDetection({ url: 'https://claude.ai/new' });
  await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#learn-name')!.hidden).toBe(false));
  popup.sendMessage.mockImplementation(async (message) => {
    if (message.type === 'ROVER_GET_LEARN_TARGETS') return { targets };
    if (message.type === 'ROVER_GET_ACTIVE_PROVIDER') return { url: 'https://claude.ai/new' };
    return null;
  });
  document.querySelector<HTMLButtonElement>('#learn-mode')!.click();
  await vi.waitFor(() => expect(popup.sendMessage).toHaveBeenCalledWith({ type: 'ROVER_GET_LEARN_TARGETS' }));
  const target = document.querySelector<HTMLElement>('#learn-target')!;
  await vi.waitFor(() => {
    if (!targets.length) {
      expect(target.hidden).toBe(true);
      expect(target.textContent).toBe('');
    } else if (targets.length === 1) {
      expect(target.hidden).toBe(false);
      expect(target.textContent).toBe('Updating: Claude');
    } else {
      expect(target.hidden).toBe(false);
      expect(target.querySelectorAll('option')).toHaveLength(3);
    }
  });
});
