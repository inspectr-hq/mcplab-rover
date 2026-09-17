// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startProviderDiscovery } from '../src/providers/provider-discovery';

describe('provider discovery recovery', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('emits a profile when a response appeared before the composer was detected', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    const drafts: unknown[] = [];
    const stop = startProviderDiscovery((draft) => drafts.push(draft));
    const send = document.createElement('button');
    send.textContent = 'Send';
    document.body.append(send);
    send.click();
    const response = document.createElement('div');
    response.setAttribute('data-message-author-role', 'assistant');
    response.textContent = 'A newly discovered answer';
    Object.defineProperty(response, 'innerText', {
      value: 'A newly discovered answer',
      configurable: true
    });
    document.body.append(response);
    await new Promise((resolve) => setTimeout(resolve, 550));

    const composer = document.createElement('textarea');
    document.body.append(composer);
    composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      trace: {
        observedGeneration: false,
        events: expect.arrayContaining([
          expect.objectContaining({ phase: 'submitted' }),
          expect.objectContaining({ phase: 'final' })
        ])
      }
    });
    expect(JSON.stringify(drafts[0])).not.toContain('A newly discovered answer');
    stop();
  });

  it('captures a new-chat control exposed as a focusable element with nested text', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    const drafts: any[] = [];
    const stop = startProviderDiscovery((draft) => drafts.push(draft));
    const send = document.createElement('button');
    send.textContent = 'Send';
    document.body.append(send);
    send.click();
    const composer = document.createElement('textarea');
    document.body.append(composer);
    composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const newChat = document.createElement('div');
    newChat.setAttribute('tabindex', '0');
    newChat.setAttribute('data-test', 'ai-agent_chat_new-chat');
    newChat.innerHTML = '<span>add</span>';
    document.body.append(newChat);
    const response = document.createElement('div');
    response.setAttribute('data-message-author-role', 'assistant');
    response.textContent = 'A newly discovered answer';
    Object.defineProperty(response, 'innerText', {
      value: 'A newly discovered answer',
      configurable: true
    });
    document.body.append(response);
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(drafts).toHaveLength(1);
    expect(drafts[0].profile.newConversation).toEqual(
      expect.objectContaining({
        action: 'click',
        locator: expect.objectContaining({ segments: expect.any(Array) })
      })
    );
    stop();
  });

  it('learns state-aware completion locators when a disabled submit signals generation', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    const drafts: any[] = [];
    const stop = startProviderDiscovery((draft) => drafts.push(draft));
    const composer = document.createElement('textarea');
    const submit = document.createElement('button');
    submit.setAttribute('aria-label', 'Submit');
    submit.disabled = false;
    document.body.append(composer, submit);
    composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    submit.click();
    submit.disabled = true;
    setTimeout(() => {
      submit.disabled = false;
    }, 350);
    const response = document.createElement('div');
    response.setAttribute('data-message-author-role', 'assistant');
    response.textContent = 'A completed answer';
    Object.defineProperty(response, 'innerText', {
      value: 'A completed answer',
      configurable: true
    });
    document.body.append(response);
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(drafts).toHaveLength(1);
    expect(drafts[0].trace.observedGeneration).toBe(true);
    expect(drafts[0].profile.completion.generatingLocator.segments.at(-1)).toContain(':disabled');
    expect(drafts[0].profile.completion.idleLocator.segments.at(-1)).toContain(':not([disabled])');
    stop();
  });
});
