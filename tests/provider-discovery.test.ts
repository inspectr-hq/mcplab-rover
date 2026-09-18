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
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
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
    expect(drafts[0].validationReasons).not.toContain(
      'Composer selector was not observed in the baseline snapshot.'
    );
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
    session.stop();
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
    const session = startProviderDiscovery((draft) => drafts.push(draft));
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
    session.stop();
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
    const session = startProviderDiscovery((draft) => drafts.push(draft));
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
    session.stop();
  });

  it('learns an abort control as generation and submit as idle', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    const composer = document.createElement('textarea');
    const submit = document.createElement('button');
    submit.setAttribute('aria-label', 'Submit');
    document.body.append(composer, submit);
    composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    submit.click();
    setTimeout(() => {
      submit.setAttribute('aria-label', 'Abort');
      submit.setAttribute('title', 'Abort');
      submit.textContent = 'Abort';
    }, 100);
    setTimeout(() => {
      const response = document.createElement('div');
      response.setAttribute('data-message-author-role', 'assistant');
      response.textContent = 'A completed answer';
      Object.defineProperty(response, 'innerText', {
        value: 'A completed answer',
        configurable: true
      });
      document.body.append(response);
    }, 300);
    setTimeout(() => {
      submit.setAttribute('aria-label', 'Submit');
      submit.setAttribute('title', 'Submit');
      submit.textContent = 'Submit';
    }, 450);
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect(drafts).toHaveLength(1);
    expect(drafts[0].trace.observedGeneration).toBe(true);
    expect(drafts[0].profile.completion.generatingLocator.segments.at(-1)).toBe(
      '[aria-label="Abort"]'
    );
    expect(drafts[0].profile.completion.idleLocator.segments.at(-1)).toBe(
      '[aria-label="Submit"]:not([disabled])'
    );
    expect(drafts[0].capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'completion',
          confidence: 'high',
          detail: 'Observed the generation control and its idle transition.'
        })
      ])
    );
    session.stop();
  });

  it('reports live progress as the composer and response are detected', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    const drafts: any[] = [];
    const progressUpdates: any[] = [];
    const session = startProviderDiscovery(
      (draft) => drafts.push(draft),
      (progress) => progressUpdates.push(progress)
    );

    const composer = document.createElement('textarea');
    document.body.append(composer);
    composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(progressUpdates.at(-1)).toMatchObject({ composerDetected: true, submitDetected: false });

    const send = document.createElement('button');
    send.textContent = 'Send';
    document.body.append(send);
    send.click();
    expect(progressUpdates.at(-1)).toMatchObject({ composerDetected: true, submitDetected: true });

    const response = document.createElement('div');
    response.setAttribute('data-message-author-role', 'assistant');
    response.textContent = 'A newly discovered answer';
    Object.defineProperty(response, 'innerText', {
      value: 'A newly discovered answer',
      configurable: true
    });
    document.body.append(response);
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(progressUpdates.at(-1)).toMatchObject({
      assistantDetected: true,
      assistantPreview: 'A newly discovered answer'
    });
    session.stop();
  });

  it('lets learning be manually captured once a composer and response are both known', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));

    expect(session.capture()).toBe(false);
    expect(drafts).toHaveLength(0);

    const composer = document.createElement('textarea');
    const submit = document.createElement('button');
    submit.setAttribute('aria-label', 'Submit');
    document.body.append(composer, submit);
    composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    submit.click();
    // Leave the submit control disabled so the automatic idle/stability check never
    // fires on its own — only the manual capture() call should be able to emit.
    submit.disabled = true;

    expect(session.capture()).toBe(false);
    expect(drafts).toHaveLength(0);

    const response = document.createElement('div');
    response.setAttribute('data-message-author-role', 'assistant');
    response.textContent = 'A still-generating answer';
    Object.defineProperty(response, 'innerText', {
      value: 'A still-generating answer',
      configurable: true
    });
    document.body.append(response);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(drafts).toHaveLength(0);
    expect(session.capture()).toBe(true);
    expect(drafts).toHaveLength(1);
    expect(session.capture()).toBe(false);
    expect(drafts).toHaveLength(1);
  });
});
