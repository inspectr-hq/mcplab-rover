// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatgptAdapter } from '../src/providers/chatgpt';
import { claudeAdapter } from '../src/providers/claude';
import { createMcplabAdapter } from '../src/providers/mcplab';
import type { ChatProviderAdapter } from '../src/providers/types';
import {
  adapters,
  findAdapter,
  findPageAdapter,
  findPageAdapters,
  isBuiltInProvider,
  setLearnedProfiles
} from '../src/providers';
import { isValidBrowserProviderProfile } from '../src/providers/profile-validation';
import { selectResponseCandidate } from '../src/runtime/candidate-selection';

const learnedProfile = {
  schemaVersion: 1 as const,
  id: 'chatgpt-com',
  name: 'ChatGPT',
  match: { origins: ['https://chatgpt.com'] },
  composer: {
    locator: { segments: ['[contenteditable="true"]'] },
    inputMode: 'contenteditable' as const
  },
  submit: { action: 'enter' as const },
  assistantMessages: { locator: { segments: ['[data-message-author-role="assistant"]'] } },
  completion: { stabilityMs: 1000 },
  newConversation: {
    action: 'click' as const,
    locator: { segments: ['[data-testid="new-chat"]'] }
  },
  learned: {
    sourceOrigin: 'https://chatgpt.com',
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:01:00.000Z',
    confidence: {}
  }
};

const testProviderProfile = {
  schemaVersion: 1 as const,
  id: 'test-provider',
  name: 'Test Provider',
  match: { origins: [location.origin] },
  composer: {
    locator: { segments: ['[data-test="ai-agent_input"]'] },
    inputMode: 'textarea' as const
  },
  submit: {
    action: 'click' as const,
    locator: { segments: ['button[aria-label="Submit"]'] }
  },
  assistantMessages: {
    locator: { segments: ['[data-test="chat-messages_message"]'] }
  },
  completion: { stabilityMs: 1000 },
  newConversation: {
    action: 'click' as const,
    locator: { segments: ['button[aria-label="New chat"]'] }
  },
  learned: {
    sourceOrigin: location.origin,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:01:00.000Z',
    confidence: {}
  }
};

function evaluate(adapter: ChatProviderAdapter, candidates = adapter.getAssistantCandidates()) {
  return adapter.signalEvaluator.evaluate(candidates, Date.now());
}

describe('learned provider profile validation', () => {
  it('rejects an invalid New Chat alternative even when the primary locator is valid', () => {
    expect(isValidBrowserProviderProfile({
      ...learnedProfile,
      newConversation: {
        action: 'click',
        locator: { segments: ['[data-testid="new-chat"]'] },
        locators: [{ segments: [] }]
      }
    })).toBe(false);
  });

  it('rejects malformed optional locators instead of treating them as absent', () => {
    expect(
      isValidBrowserProviderProfile({
        ...learnedProfile,
        assistantMessages: { ...learnedProfile.assistantMessages, textLocator: 'not-a-locator' }
      })
    ).toBe(false);
    expect(isValidBrowserProviderProfile(learnedProfile)).toBe(true);
  });
});

describe('provider catalog helpers', () => {
  it('centralizes built-in provider identity', () => {
    expect(isBuiltInProvider('claude')).toBe(true);
    expect(isBuiltInProvider('chatgpt-com')).toBe(true);
    expect(isBuiltInProvider('custom-browser')).toBe(false);
  });
});

describe('ChatGPT adapter', () => {
  it('excludes user conversation turns from assistant candidates', () => {
    document.body.innerHTML = `
      <div aria-label="Chat with ChatGPT" contenteditable="true"></div>
      <div data-testid="conversation-turn-1" data-message-author-role="user">The submitted prompt</div>
    `;

    expect(chatgptAdapter.getAssistantCandidates()).toEqual([]);
  });

  it('detects the composer and assistant response markers', () => {
    document.body.innerHTML = `
      <div aria-label="Chat with ChatGPT" contenteditable="true"></div>
      <div data-message-author-role="assistant">ChatGPT answer</div>
    `;

    expect(chatgptAdapter.canHandle()).toBe(true);
    expect(chatgptAdapter.findComposer()).toBeTruthy();
    expect(chatgptAdapter.getAssistantCandidates()[0]?.text).toContain('ChatGPT answer');
    expect(evaluate(chatgptAdapter)).toMatchObject({
      response: expect.objectContaining({ text: 'ChatGPT answer' }),
      signals: { idle_visible: true, input_enabled: true }
    });
  });

  it('starts a new conversation through the native control', async () => {
    document.body.innerHTML = `
      <div aria-label="Chat with ChatGPT" contenteditable="true"></div>
      <button aria-label="New chat">New chat</button>
    `;
    let clicks = 0;
    document.querySelector('button')!.addEventListener('click', () => clicks++);

    await chatgptAdapter.startNewConversation?.();

    expect(clicks).toBe(1);
  });
});

describe('Claude adapter', () => {
  it('gives separate replies distinct keys when their test IDs repeat', () => {
    document.body.innerHTML = '<div data-testid="assistant-message">First reply</div>';
    const baseline = claudeAdapter.getAssistantCandidates();
    document.body.insertAdjacentHTML('beforeend', '<div data-testid="assistant-message">Second reply</div>');

    const current = claudeAdapter.getAssistantCandidates();
    expect(current[1]?.key).not.toBe(current[0]?.key);
    expect(selectResponseCandidate(
      baseline.map((candidate) => ({ ...candidate, visible: true })),
      current.map((candidate) => ({ ...candidate, visible: true }))
    )?.text).toBe('Second reply');
  });

  it('reports missing composer and controls without throwing', () => {
    document.body.innerHTML = '';

    expect(claudeAdapter.getDebugChecks()).toEqual([
      expect.objectContaining({ id: 'composer', present: false }),
      expect.objectContaining({ id: 'submit', present: false }),
      expect.objectContaining({ id: 'assistant-response', present: false })
    ]);
  });

  it('waits for the send button to become enabled after input', async () => {
    document.body.innerHTML = `
      <div contenteditable="true" class="ProseMirror"><p></p></div>
      <button aria-label="Send message" disabled>Send</button>
    `;
    const button = document.querySelector('button')!;
    setTimeout(() => button.removeAttribute('disabled'), 5);

    await claudeAdapter.setComposerText('Injected prompt');
    await claudeAdapter.submit();

    expect(button.hasAttribute('disabled')).toBe(false);
    expect(document.querySelector('.ProseMirror p')?.textContent).toBe('Injected prompt');
  });

  it('captures Claude responses exposed through streaming containers', () => {
    document.body.innerHTML = `
      <div data-is-streaming="false">
        <div class="font-claude-response">Claude answer</div>
      </div>
    `;

    expect(claudeAdapter.getAssistantCandidates().at(-1)?.text).toContain('Claude answer');
  });

  it('considers a completed streaming container idle without requiring a visible send button', () => {
    document.body.innerHTML = `
      <div data-is-streaming="false">
        <div class="font-claude-response">Claude answer</div>
      </div>
    `;
    const candidates = claudeAdapter.getAssistantCandidates();
    const state = evaluate(claudeAdapter, candidates);

    expect(state.signals.generation_active).toBe(false);
    expect(state.signals.idle_visible).toBe(true);
    expect(state.response?.text).toContain('Claude answer');
    expect(state.signals).toMatchObject({
      idle_visible: true
    });
  });
});

describe('Learned provider adapter', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
  });
  afterEach(() => vi.restoreAllMocks());

  it('lists all same-origin learned profiles that can handle the current DOM', () => {
    document.body.innerHTML = '<textarea data-provider="generic"></textarea><textarea data-provider="lumen"></textarea>';
    setLearnedProfiles([
      {
        ...testProviderProfile,
        id: 'generic',
        composer: { locator: { segments: ['textarea[data-provider="generic"]'] }, inputMode: 'textarea' }
      },
      {
        ...testProviderProfile,
        id: 'lumen',
        composer: { locator: { segments: ['textarea[data-provider="lumen"]'] }, inputMode: 'textarea' }
      }
    ]);

    expect(findPageAdapters().map((adapter) => adapter.id)).toEqual(['generic', 'lumen']);
  });

  it('does not click an unrelated first button for a broad New Chat locator', async () => {
    document.body.innerHTML = '<textarea data-test="ai-agent_input"></textarea><button aria-label="Submit">Submit</button><button title="New chat">New chat</button><div data-test="chat-messages_message">Previous answer</div>';
    const adapter = createMcplabAdapter({
      ...testProviderProfile,
      newConversation: {
        action: 'click',
        locator: { segments: ['button'] },
        confirmation: 'context-change'
      }
    });
    for (const button of Array.from(document.querySelectorAll('button')))
      Object.defineProperty(button, 'getBoundingClientRect', {
        value: () => ({ width: 10, height: 10 })
      });
    let submitClicks = 0;
    document.querySelector('[aria-label="Submit"]')!.addEventListener('click', () => submitClicks++);
    document.querySelector('[title="New chat"]')!.addEventListener('click', () => {
      document.querySelector('[data-test="chat-messages_message"]')!.remove();
    });
    await expect(adapter.startNewConversation?.()).resolves.toBeUndefined();
    expect(submitClicks).toBe(0);
  });

  it('ignores a hidden generation control the same way Learning does', () => {
    document.body.innerHTML = `
      <textarea data-test="ai-agent_input"></textarea>
      <button aria-label="Submit">Submit</button>
      <button aria-label="Stop generating" style="display: none">Stop</button>
    `;
    Object.defineProperty(document.querySelector('[aria-label="Stop generating"]'), 'getBoundingClientRect', {
      value: () => ({ width: 10, height: 10 })
    });
    const adapter = createMcplabAdapter({
      ...testProviderProfile,
      completion: {
        stabilityMs: 1000,
        generatingLocator: { segments: ['[aria-label="Stop generating"]'] }
      }
    });
    expect(evaluate(adapter, [])).toMatchObject({
      signals: { generation_active: false, idle_visible: true }
    });
  });

  it('does not let a heuristic cancel control override a configured generation locator', () => {
    document.body.innerHTML = `
      <textarea data-test="ai-agent_input"></textarea>
      <button aria-label="Cancel upload">Cancel</button>
    `;
    Object.defineProperty(document.querySelector('[aria-label="Cancel upload"]'), 'getBoundingClientRect', {
      value: () => ({ width: 10, height: 10 })
    });
    const adapter = createMcplabAdapter({
      ...testProviderProfile,
      completion: {
        stabilityMs: 1000,
        generatingLocator: { segments: ['[aria-label="Stop generating"]'] }
      }
    });

    expect(evaluate(adapter, [])).toMatchObject({
      signals: { generation_active: false, stop_visible: false }
    });
  });

  it('does not let an enabled composer override a configured idle locator', () => {
    document.body.innerHTML = '<textarea data-test="ai-agent_input"></textarea>';
    const adapter = createMcplabAdapter({
      ...testProviderProfile,
      completion: {
        ...testProviderProfile.completion,
        idleLocator: { segments: ['[data-state="ready"]'] }
      }
    });

    expect(evaluate(adapter, [])).toMatchObject({ signals: { idle_visible: false } });
  });

  it('reads each assistant turn from its own text locator', () => {
    document.body.innerHTML = `
      <div data-test="chat-messages_message" data-message-id="one"><p class="answer">First answer</p></div>
      <div data-test="chat-messages_message" data-message-id="two"><p class="answer">Second answer</p></div>
    `;
    const adapter = createMcplabAdapter({
      ...testProviderProfile,
      assistantMessages: {
        ...testProviderProfile.assistantMessages,
        textLocator: { segments: ['.answer'] }
      }
    });
    expect(adapter.getAssistantCandidates().map((candidate) => candidate.text)).toEqual([
      'First answer',
      'Second answer'
    ]);
  });

  it('reports a configured independent working indicator', () => {
    document.body.innerHTML = '<textarea data-test="ai-agent_input"></textarea><div data-state="tool-running">Searching</div>';
    Object.defineProperty(document.querySelector('[data-state="tool-running"]'), 'getBoundingClientRect', {
      value: () => ({ width: 10, height: 10 })
    });
    const adapter = createMcplabAdapter({
      ...testProviderProfile,
      completion: {
        ...testProviderProfile.completion,
        workingLocator: { segments: ['[data-state="tool-running"]'] }
      }
    });
    expect(evaluate(adapter, [])).toMatchObject({ signals: { working_visible: true } });
  });

  it('does not confirm a new conversation from an unrelated body mutation', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<textarea data-test="ai-agent_input"></textarea><button aria-label="New chat">New chat</button><div data-test="chat-messages_message">Previous answer</div>';
      const adapter = createMcplabAdapter({
        ...testProviderProfile,
        newConversation: {
          action: 'click',
          locator: { segments: ['button[aria-label="New chat"]'] },
          confirmation: 'context-change'
        }
      });
      document.querySelector('button')!.addEventListener('click', () => {
        document.body.append(document.createElement('span'));
      });
      const outcome = adapter.startNewConversation!().then(
        () => 'resolved',
        (error: Error) => error.message
      );
      await vi.advanceTimersByTimeAsync(15_100);
      expect(await outcome).toContain('new conversation did not become ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not confirm a legacy new conversation from an unrelated body mutation', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<textarea data-test="ai-agent_input"></textarea><button aria-label="New chat">New chat</button><div data-test="chat-messages_message">Previous answer</div>';
      const adapter = createMcplabAdapter(testProviderProfile);
      document.querySelector('button')!.addEventListener('click', () => {
        document.body.append(document.createElement('span'));
      });
      const outcome = adapter.startNewConversation!().then(
        () => 'resolved',
        (error: Error) => error.message
      );
      await vi.advanceTimersByTimeAsync(15_100);
      expect(await outcome).toContain('new conversation did not become ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('confirms a learned click when the previous assistant turn disappears', async () => {
    document.body.innerHTML = '<textarea data-test="ai-agent_input"></textarea><button aria-label="New chat">New chat</button><div data-test="chat-messages_message">Previous answer</div>';
    const adapter = createMcplabAdapter({
      ...testProviderProfile,
      newConversation: {
        action: 'click',
        locator: { segments: ['button[aria-label="New chat"]'] },
        confirmation: 'context-change'
      }
    });
    document.querySelector('button')!.addEventListener('click', () => {
      document.querySelector('[data-test="chat-messages_message"]')!.remove();
    });
    await expect(adapter.startNewConversation?.()).resolves.toBeUndefined();
  });

  it('keeps one assistant turn key stable as its text streams and its DOM node rerenders', () => {
    document.body.innerHTML = '<textarea data-test="ai-agent_input"></textarea><div data-test="chat-messages_message" data-message-id="answer-1">Short</div>';
    const adapter = createMcplabAdapter(testProviderProfile);
    const firstKey = adapter.getAssistantCandidates()[0].key;
    document.querySelector('[data-message-id="answer-1"]')!.textContent = 'A longer streamed answer';
    expect(adapter.getAssistantCandidates()[0].key).toBe(firstKey);
    document.querySelector('[data-message-id="answer-1"]')!.outerHTML =
      '<div data-test="chat-messages_message" data-message-id="answer-1">A rerendered answer</div>';
    expect(adapter.getAssistantCandidates()[0].key).toBe(firstKey);
  });

  it('does not transfer an assistant turn key to a different node after insertion', () => {
    document.body.innerHTML = '<textarea data-test="ai-agent_input"></textarea><div data-test="chat-messages_message">First answer</div><div data-test="chat-messages_message">Second answer</div>';
    const adapter = createMcplabAdapter(testProviderProfile);
    const existing = Array.from(document.querySelectorAll('[data-test="chat-messages_message"]'));
    const before = adapter.getAssistantCandidates().map((candidate) => candidate.key);
    const earlier = document.createElement('div');
    earlier.setAttribute('data-test', 'chat-messages_message');
    earlier.textContent = 'Earlier answer';
    existing[0].before(earlier);
    const after = adapter.getAssistantCandidates().map((candidate) => candidate.key);
    expect(after[1]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
    expect(after[0]).not.toBe(before[0]);
  });

  it('uses the learned composer, Enter submission, and assistant locator', async () => {
    document.body.innerHTML = `
      <div contenteditable="true"></div>
      <div data-message-author-role="assistant">Learned response</div>
    `;
    const adapter = createMcplabAdapter(learnedProfile);
    let keyEvents = 0;
    document
      .querySelector('[contenteditable="true"]')!
      .addEventListener('keydown', () => keyEvents++);

    await adapter.setComposerText('Learned prompt');
    await adapter.submit();

    expect(adapter.findComposer()?.textContent).toBe('Learned prompt');
    expect(keyEvents).toBe(1);
    expect(adapter.getAssistantCandidates()[0]?.text).toBe('Learned response');
  });

  it('reads only visible assistant content and updates a textarea composer', async () => {
    document.body.innerHTML = `
      <textarea data-test="ai-agent_input"></textarea>
      <button aria-label="Submit">Submit</button>
      <div data-test="chat-messages_message" class="chat-messages__message chat-messages__message--assistant">
        <div class="chat-messages__message-content"><p>Visible answer</p></div>
      </div>
    `;
    const adapter = createMcplabAdapter(testProviderProfile);
    const composer = adapter.findComposer() as HTMLTextAreaElement;
    let inputEvents = 0;
    composer.addEventListener('input', () => inputEvents++);

    await adapter.setComposerText('Injected prompt');

    expect(composer.value).toBe('Injected prompt');
    expect(inputEvents).toBe(1);
    expect(adapter.getAssistantCandidates()[0]?.text).toContain('Visible answer');
  });

  it('starts a new conversation through a learned control and waits for a textarea composer to clear', async () => {
    document.body.innerHTML = `
      <textarea data-test="ai-agent_input">Previous prompt</textarea>
      <button aria-label="New chat">New chat</button>
    `;
    const adapter = createMcplabAdapter(testProviderProfile);
    const composer = document.querySelector('textarea')!;
    let clicks = 0;
    document.querySelector('button')!.addEventListener('click', () => {
      clicks++;
      setTimeout(() => {
        composer.value = '';
      }, 10);
    });

    await adapter.startNewConversation?.();

    expect(clicks).toBe(1);
    expect(composer.value).toBe('');
  });

  it('clicks a visible send control when an Enter-based profile exposes one', async () => {
    document.body.innerHTML = `
      <div contenteditable="true"></div>
      <button aria-label="Send message">Send</button>
    `;
    const adapter = createMcplabAdapter(learnedProfile);
    let clicks = 0;
    const button = document.querySelector('button')!;
    Object.defineProperty(button, 'getBoundingClientRect', {
      value: () => ({ width: 10, height: 10 })
    });
    button.addEventListener('click', () => clicks++);

    await adapter.setComposerText('Learned prompt');
    await adapter.submit();

    expect(clicks).toBe(1);
  });

  it('uses the learned new-conversation control', async () => {
    document.body.innerHTML = `
      <div contenteditable="true">Previous prompt</div>
      <button data-testid="new-chat">New chat</button>
    `;
    const adapter = createMcplabAdapter(learnedProfile);
    let clicks = 0;
    const composer = document.querySelector('[contenteditable="true"]')!;
    document.querySelector('button')!.addEventListener('click', () => {
      clicks++;
      setTimeout(() => {
        composer.textContent = '';
      }, 10);
    });

    await adapter.startNewConversation?.();

    expect(clicks).toBe(1);
    expect(composer.textContent).toBe('');
  });

  it('tries learned new-conversation locators in order', async () => {
    document.body.innerHTML = `
      <div contenteditable="true">Previous prompt</div>
      <button aria-label="New chat">New chat</button>
    `;
    const adapter = createMcplabAdapter({
      ...learnedProfile,
      newConversation: {
        action: 'click',
        locator: { segments: ['[data-testid="missing-new-chat"]'] },
        locators: [{ segments: ['button[aria-label="New chat"]'] }]
      }
    });
    const composer = document.querySelector('[contenteditable="true"]')!;
    const button = document.querySelector('button')!;
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks++;
      composer.textContent = '';
    });

    await adapter.startNewConversation?.();

    expect(clicks).toBe(1);
    expect(composer.textContent).toBe('');
  });

  it('clicks an actionable child when a learned locator targets a wrapper', async () => {
    document.body.innerHTML = `
      <textarea data-test="ai-agent_input">Previous prompt</textarea>
      <tm-icon-button data-test="ai-agent_chat_new-chat"><button title="New chat">New chat</button></tm-icon-button>
    `;
    const adapter = createMcplabAdapter({
      ...testProviderProfile,
      newConversation: {
        action: 'click',
        locator: { segments: ['[data-test="ai-agent_chat_new-chat"]'] }
      }
    });
    const composer = document.querySelector('textarea')!;
    const button = document.querySelector('button')!;
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks++;
      composer.value = '';
      document.querySelector('[data-test="chat-messages_message"]')?.remove();
    });
    const message = document.createElement('div');
    message.setAttribute('data-test', 'chat-messages_message');
    message.textContent = 'Previous answer';
    document.body.append(message);

    await adapter.startNewConversation?.();

    expect(clicks).toBe(1);
    expect(composer.value).toBe('');
  });

  it('reports the learned new-conversation control in debug checks', () => {
    document.body.innerHTML = `
      <div contenteditable="true"></div>
      <button data-testid="new-chat">New chat</button>
    `;
    const adapter = createMcplabAdapter(learnedProfile);

    expect(adapter.getDebugChecks()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'new-chat', label: 'New conversation', present: true })
      ])
    );
  });

  it('reports a valid learned navigation action as available', () => {
    document.body.innerHTML = '<div contenteditable="true"></div>';
    const adapter = createMcplabAdapter({
      ...learnedProfile,
      newConversation: { action: 'navigate', url: 'https://chatgpt.com/' }
    });

    expect(adapter.getDebugChecks()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'new-chat', label: 'New conversation', present: true })
      ])
    );
  });

  it('detects generation from a disabled fallback submit control', () => {
    document.body.innerHTML = `
      <textarea></textarea>
      <button aria-label="Submit" disabled>Submit</button>
      <div data-message-author-role="assistant">Streaming answer</div>
    `;
    Object.defineProperty(document.querySelector('button'), 'getBoundingClientRect', {
      value: () => ({ width: 10, height: 10 })
    });
    const adapter = createMcplabAdapter({
      ...learnedProfile,
      submit: { action: 'enter' }
    });

    expect(evaluate(adapter)).toMatchObject({
      signals: { generation_active: true, idle_visible: false }
    });
  });

  it('stops generation through a visible stop control', async () => {
    document.body.innerHTML = '<button aria-label="Stop generating">Stop</button>';
    const button = document.querySelector('button')!;
    Object.defineProperty(button, 'getBoundingClientRect', {
      value: () => ({ width: 10, height: 10 })
    });
    let clicks = 0;
    button.addEventListener('click', () => clicks++);
    const adapter = createMcplabAdapter(learnedProfile);

    await adapter.stopGeneration?.();

    expect(clicks).toBe(1);
  });

  it('detects and cancels a visible abort control', async () => {
    document.body.innerHTML = '<button aria-label="Abort" title="Abort">Abort</button>';
    const button = document.querySelector('button')!;
    Object.defineProperty(button, 'getBoundingClientRect', {
      value: () => ({ width: 10, height: 10 })
    });
    let clicks = 0;
    button.addEventListener('click', () => clicks++);
    const adapter = createMcplabAdapter(learnedProfile);

    expect(evaluate(adapter, [])).toMatchObject({
      signals: { generation_active: true, idle_visible: false }
    });
    await adapter.stopGeneration?.();

    expect(clicks).toBe(1);
  });

  it('prioritizes a matching learned profile and falls back when cleared', () => {
    document.body.innerHTML = '<div contenteditable="true"></div>';
    setLearnedProfiles([
      {
        ...learnedProfile,
        id: 'm365-cloud-microsoft',
        name: 'M365',
        match: { origins: [location.origin] }
      }
    ]);

    expect(findPageAdapter()?.id).toBe('m365-cloud-microsoft');

    setLearnedProfiles([]);
    expect(findAdapter()?.id).toBeUndefined();
  });

  it('ignores malformed learned profiles without affecting built-in detection', () => {
    document.body.innerHTML = '<div aria-label="Chat with ChatGPT" contenteditable="true"></div>';

    expect(() => setLearnedProfiles([{ id: 'broken' } as never])).not.toThrow();
    expect(adapters.map((adapter) => adapter.id)).toEqual(['claude', 'chatgpt-com']);

    expect(() =>
      setLearnedProfiles([
        {
          ...learnedProfile,
          composer: { ...learnedProfile.composer, locator: { segments: ['['] } }
        }
      ])
    ).not.toThrow();
    expect(adapters.map((adapter) => adapter.id)).toEqual(['claude', 'chatgpt-com']);
  });
});
