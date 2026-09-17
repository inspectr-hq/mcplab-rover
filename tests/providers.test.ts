// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { chatgptAdapter } from '../src/providers/chatgpt';
import { claudeAdapter } from '../src/providers/claude';
import { createLearnedAdapter } from '../src/providers/learned';
import {
  adapters,
  findAdapter,
  findPageAdapter,
  isBuiltInProvider,
  setLearnedProfiles
} from '../src/providers';
import { isValidBrowserProviderProfile } from '../src/providers/profile-validation';

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

describe('learned provider profile validation', () => {
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
  it('detects the composer and assistant response markers', () => {
    document.body.innerHTML = `
      <div aria-label="Chat with ChatGPT" contenteditable="true"></div>
      <div data-message-author-role="assistant">ChatGPT answer</div>
    `;

    expect(chatgptAdapter.canHandle()).toBe(true);
    expect(chatgptAdapter.findComposer()).toBeTruthy();
    expect(chatgptAdapter.getAssistantCandidates()[0]?.text).toContain('ChatGPT answer');
    expect(chatgptAdapter.getResponseState(chatgptAdapter.getAssistantCandidates())).toMatchObject({
      isGenerating: false,
      isIdle: true
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
    const state = claudeAdapter.getResponseState(candidates);

    expect(state.isGenerating).toBe(false);
    expect(state.isIdle).toBe(true);
    expect(state.text).toContain('Claude answer');
  });
});

describe('Learned provider adapter', () => {
  it('uses the learned composer, Enter submission, and assistant locator', async () => {
    document.body.innerHTML = `
      <div contenteditable="true"></div>
      <div data-message-author-role="assistant">Learned response</div>
    `;
    const adapter = createLearnedAdapter(learnedProfile);
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
    const adapter = createLearnedAdapter(testProviderProfile);
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
    const adapter = createLearnedAdapter(testProviderProfile);
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
    const adapter = createLearnedAdapter(learnedProfile);
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
    const adapter = createLearnedAdapter(learnedProfile);
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

  it('reports the learned new-conversation control in debug checks', () => {
    document.body.innerHTML = `
      <div contenteditable="true"></div>
      <button data-testid="new-chat">New chat</button>
    `;
    const adapter = createLearnedAdapter(learnedProfile);

    expect(adapter.getDebugChecks()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'new-chat', label: 'New conversation', present: true })
      ])
    );
  });

  it('reports a valid learned navigation action as available', () => {
    document.body.innerHTML = '<div contenteditable="true"></div>';
    const adapter = createLearnedAdapter({
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
    const adapter = createLearnedAdapter({
      ...learnedProfile,
      submit: { action: 'enter' }
    });

    expect(adapter.getResponseState(adapter.getAssistantCandidates())).toMatchObject({
      isGenerating: true,
      isIdle: false
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
    const adapter = createLearnedAdapter(learnedProfile);

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
