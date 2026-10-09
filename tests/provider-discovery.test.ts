// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startProviderDiscovery } from '../src/providers/provider-discovery';
import { createMcplabAdapter } from '../src/providers/mcplab';
import { ask } from '../src/runtime/ask';

describe('provider discovery recovery', { timeout: 10_000 }, () => {
  it('reports the initial waiting state before the user interacts with the chat', () => {
    const report = vi.fn();
    const session = startProviderDiscovery(vi.fn(), report);
    try {
      expect(report).toHaveBeenCalledWith({
        composerDetected: false,
        submitDetected: false,
        assistantDetected: false,
        generatingObserved: false,
        idleObserved: false
      });
    } finally {
      session.stop();
    }
  });

  it.each(['enter', 'click'])(
    'observes %s submission from an open shadow-root chat',
    (submission) => {
      Object.defineProperty(globalThis, 'CSS', {
        value: { escape: (value: string) => value },
        configurable: true
      });
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 10,
        height: 10
      } as DOMRect);
      const host = document.createElement('polo-chat');
      document.body.append(host);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<textarea></textarea><button aria-label="Send">Send</button>';
      const report = vi.fn();
      const session = startProviderDiscovery(vi.fn(), report);
      try {
        const composer = shadow.querySelector('textarea')!;
        composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
        expect(report.mock.calls.at(-1)?.[0].composerDetected).toBe(true);
        composer.value = 'Hello';
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
        if (submission === 'enter') {
          composer.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true })
          );
        } else {
          shadow.querySelector('button')!.click();
        }
        expect(report.mock.calls.at(-1)?.[0]).toMatchObject({
          composerDetected: true,
          submitDetected: true
        });
      } finally {
        session.stop();
      }
    }
  );
  it('does not capture during a brief gap in generation controls', async () => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML = '<textarea></textarea><button aria-label="Send">Send</button>';
    const drafts: any[] = [];
    const progress: any[] = [];
    const session = startProviderDiscovery(
      (draft) => drafts.push(draft),
      (update) => progress.push(update)
    );
    try {
      document
        .querySelector('textarea')!
        .dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      const send = document.querySelector('button')!;
      send.click();
      send.setAttribute('aria-label', 'Stop generating');
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div data-message-author-role="assistant">Partial reply</div>'
      );
      const answer = document.querySelector<HTMLElement>('[data-message-author-role]')!;
      Object.defineProperty(answer, 'innerText', {
        get: () => answer.textContent,
        configurable: true
      });
      await vi.advanceTimersByTimeAsync(1000);
      send.setAttribute('aria-label', 'Send');
      await vi.advanceTimersByTimeAsync(750);
      expect(progress.at(-1)?.idleObserved).toBe(false);
      expect(drafts).toHaveLength(0);
      send.setAttribute('aria-label', 'Stop generating');
      await vi.advanceTimersByTimeAsync(1000);
      expect(drafts).toHaveLength(0);
      answer.textContent = 'The complete reply';
      send.setAttribute('aria-label', 'Send');
      await vi.advanceTimersByTimeAsync(3000);
      expect(drafts.at(-1)?.readyToSave).toBe(true);
      expect(
        drafts.at(-1)?.capabilities.find((item: any) => item.id === 'completion').confidence
      ).toBe('high');
    } finally {
      session.stop();
      vi.useRealTimers();
    }
  });

  it('waits for the full response text to stabilize after generation ends', async () => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML = '<textarea></textarea><button aria-label="Send">Send</button>';
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    try {
      document
        .querySelector('textarea')!
        .dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      const send = document.querySelector('button')!;
      send.click();
      send.setAttribute('aria-label', 'Stop generating');
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div data-message-author-role="assistant"></div>'
      );
      const answer = document.querySelector<HTMLElement>('[data-message-author-role]')!;
      answer.textContent = 'The first paragraph. '.repeat(20);
      Object.defineProperty(answer, 'innerText', {
        get: () => answer.textContent,
        configurable: true
      });
      await vi.advanceTimersByTimeAsync(1000);
      send.setAttribute('aria-label', 'Send');
      await vi.advanceTimersByTimeAsync(2000);
      answer.textContent += 'The final paragraph arrived later.';
      await vi.advanceTimersByTimeAsync(1000);
      expect(drafts).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2000);
      expect(drafts.at(-1)?.readyToSave).toBe(true);
    } finally {
      session.stop();
      vi.useRealTimers();
    }
  });

  it('does not arm a request when an unrelated control is clicked', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML =
      '<textarea></textarea><button aria-label="Open settings">Settings</button>';
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    document.querySelector('button')!.click();
    const response = document.createElement('div');
    response.setAttribute('data-testid', 'markdown-reply');
    response.textContent = 'An unrelated existing response changed';
    Object.defineProperty(response, 'innerText', {
      value: response.textContent,
      configurable: true
    });
    document.body.append(response);
    await new Promise((resolve) => setTimeout(resolve, 650));
    session.stop();
    expect(drafts).toHaveLength(0);
  });

  it('does not treat composer typing as a submitted request', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML = '<textarea></textarea><button aria-label="Send">Send</button>';
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    const composer = document.querySelector('textarea')!;
    composer.value = 'Not sent yet';
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    const response = document.createElement('div');
    response.setAttribute('data-testid', 'markdown-reply');
    response.textContent = 'An old response changed while typing';
    Object.defineProperty(response, 'innerText', {
      value: response.textContent,
      configurable: true
    });
    document.body.append(response);
    await new Promise((resolve) => setTimeout(resolve, 650));
    session.stop();
    expect(drafts).toHaveLength(0);
  });

  it('records a confirmed same-page New Chat transition after the first draft', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML =
      '<textarea></textarea><button aria-label="Send">Send</button><button aria-label="New chat">New chat</button>';
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const send = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
    send.click();
    send.setAttribute('aria-label', 'Stop generating');
    const response = document.createElement('div');
    response.setAttribute('data-testid', 'markdown-reply');
    response.textContent = 'Answer before new conversation';
    Object.defineProperty(response, 'innerText', {
      value: response.textContent,
      configurable: true
    });
    document.body.append(response);
    await new Promise((resolve) => setTimeout(resolve, 100));
    send.setAttribute('aria-label', 'Send');
    await vi.waitFor(() => expect(drafts.length).toBeGreaterThan(0), { timeout: 3_500 });
    expect(drafts.at(-1)?.readyToSave).toBe(true);
    const newChat = document.querySelector('button[aria-label="New chat"]')!;
    newChat.addEventListener('click', () => response.remove());
    newChat.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(drafts.at(-1)?.trace.newConversationEvidence).toBeDefined(), {
      timeout: 1_500
    });
    expect(drafts.at(-1)?.readyToSave).toBe(true);
    session.stop();
    expect(drafts[0].trace.newConversationEvidence).toBeUndefined();
    expect(drafts.at(-1)?.trace.newConversationEvidence).toMatchObject({
      signal: 'assistant-count-reduced',
      beforeAssistantCount: 1,
      afterAssistantCount: 0
    });
    expect(drafts.at(-1)?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'newConversation', confidence: 'medium' })
      ])
    );
  });

  it('targets a title-only New Chat control rather than the Send button', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML =
      '<textarea></textarea><button aria-label="Send">Send</button><tm-icon-button data-test="ai-agent_chat_new-chat"><button title="New chat"></button></tm-icon-button>';
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const send = document.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
    send.click();
    send.setAttribute('aria-label', 'Stop generating');
    const response = document.createElement('div');
    response.setAttribute('data-testid', 'markdown-reply');
    response.textContent = 'A complete response before the next chat';
    Object.defineProperty(response, 'innerText', {
      value: response.textContent,
      configurable: true
    });
    document.body.append(response);
    await new Promise((resolve) => setTimeout(resolve, 100));
    send.setAttribute('aria-label', 'Send');
    await vi.waitFor(() => expect(drafts.length).toBeGreaterThan(0), { timeout: 3_500 });
    expect(drafts.at(-1).profile.newConversation.locator.segments.at(-1)).toBe(
      '[title="New chat"]'
    );
    expect(drafts.at(-1).readyToSave).toBe(true);
    const newChatHost = document.querySelector('tm-icon-button')!;
    newChatHost.addEventListener('click', () => response.remove());
    newChatHost.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(drafts.at(-1)?.trace.newConversationEvidence).toBeDefined(), {
      timeout: 1_500
    });
    expect(drafts.at(-1).trace.newConversationEvidence.controlLocator.segments).toEqual([
      '[title="New chat"]'
    ]);
    session.stop();
  });

  it('learns an assistant-scoped aria-busy indicator independently of generation', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML = '<textarea></textarea><button aria-label="Send">Send</button>';
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const send = document.querySelector('button')!;
    send.click();
    send.setAttribute('aria-label', 'Stop generating');
    const container = document.createElement('section');
    container.setAttribute('aria-busy', 'true');
    const response = document.createElement('div');
    response.setAttribute('data-testid', 'markdown-reply');
    response.textContent = 'Answer while a tool is still working';
    Object.defineProperty(response, 'innerText', {
      value: response.textContent,
      configurable: true
    });
    container.append(response);
    document.body.append(container);
    await new Promise((resolve) => setTimeout(resolve, 150));
    send.setAttribute('aria-label', 'Send');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(drafts).toHaveLength(0);
    container.setAttribute('aria-busy', 'false');
    await new Promise((resolve) => setTimeout(resolve, 3_100));
    session.stop();
    expect(drafts.at(-1)?.profile.completion.workingLocator.segments.at(-1)).toBe(
      'section[aria-busy="true"]'
    );
    expect(drafts.at(-1)?.readyToSave).toBe(true);
  });

  it('prefers aria-busy over a serialized object name for a working indicator', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML = '<textarea></textarea><button aria-label="Send">Send</button>';
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const send = document.querySelector('button')!;
    send.click();
    send.setAttribute('aria-label', 'Stop generating');
    const container = document.createElement('div');
    container.id = '[object Object]';
    container.setAttribute('name', '[object Object]');
    container.setAttribute('data-message-author-role', '[object Object]');
    container.setAttribute('role', 'article');
    container.setAttribute('aria-busy', 'true');
    const response = document.createElement('div');
    response.setAttribute('data-testid', 'markdown-reply');
    response.textContent = 'Copilot answer while its response container is busy';
    Object.defineProperty(response, 'innerText', {
      value: response.textContent,
      configurable: true
    });
    container.append(response);
    document.body.append(container);
    await new Promise((resolve) => setTimeout(resolve, 150));
    send.setAttribute('aria-label', 'Send');
    container.setAttribute('aria-busy', 'false');
    await new Promise((resolve) => setTimeout(resolve, 3_100));
    session.stop();

    expect(drafts.at(-1)?.profile.completion.workingLocator.segments.at(-1)).toBe(
      '[role="article"][aria-busy="true"]'
    );
    const workingEvidence = drafts
      .at(-1)
      ?.trace.events.find((event: any) => event.selectedElements?.working)
      ?.selectedElements.working;
    expect(workingEvidence?.selectors).not.toEqual(
      expect.arrayContaining([expect.stringContaining('[object Object]')])
    );
  });

  it('can save a no-Stop profile when an assistant-scoped busy signal ends', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML = '<textarea></textarea><button aria-label="Send">Send</button>';
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    document.querySelector('button')!.click();
    const container = document.createElement('section');
    container.setAttribute('aria-busy', 'true');
    const response = document.createElement('div');
    response.setAttribute('data-testid', 'markdown-reply');
    response.textContent = 'Answer from an agent with no Stop control';
    Object.defineProperty(response, 'innerText', {
      value: response.textContent,
      configurable: true
    });
    container.append(response);
    document.body.append(container);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(drafts).toHaveLength(0);
    container.setAttribute('aria-busy', 'false');
    await vi.waitFor(() => expect(drafts.at(-1)?.readyToSave).toBe(true), { timeout: 3_500 });
    session.stop();
    expect(drafts.at(-1)?.profile.completion.generatingLocator).toBeUndefined();
    expect(drafts.at(-1)?.profile.completion.workingLocator).toBeDefined();
  });

  it('can save a no-Stop profile when its busy indicator is removed', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML = '<textarea></textarea><button aria-label="Send">Send</button>';
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    document.querySelector('button')!.click();
    const container = document.createElement('section');
    container.setAttribute('aria-busy', 'true');
    const response = document.createElement('div');
    response.setAttribute('data-testid', 'markdown-reply');
    response.textContent = 'An answer while a separate busy marker exists';
    Object.defineProperty(response, 'innerText', {
      value: response.textContent,
      configurable: true
    });
    container.append(response);
    document.body.append(container);
    await new Promise((resolve) => setTimeout(resolve, 120));
    container.replaceWith(response);
    await vi.waitFor(() => expect(drafts.at(-1)?.readyToSave).toBe(true), { timeout: 3_500 });
    session.stop();
    expect(drafts.at(-1)?.trace.events.at(-1)?.workingActive).toBe(false);
  });

  it('retains first generation evidence through a long streaming trace', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML = '<textarea></textarea><button aria-label="Send">Send</button>';
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const send = document.querySelector('button')!;
    send.click();
    send.setAttribute('aria-label', 'Stop generating');
    const response = document.createElement('div');
    response.setAttribute('data-testid', 'markdown-reply');
    Object.defineProperty(response, 'innerText', {
      get: () => response.textContent,
      configurable: true
    });
    response.textContent = 'The first streamed chunk';
    document.body.append(response);
    await new Promise((resolve) => setTimeout(resolve, 20));
    send.setAttribute('aria-label', 'Send');
    for (let index = 0; index < 40; index += 1) {
      response.textContent = `Streaming response content ${index}`;
      await Promise.resolve();
    }
    await vi.waitFor(() => expect(drafts.at(-1)?.readyToSave).toBe(true), { timeout: 3_500 });
    session.stop();
    expect(drafts.at(-1).trace.events.length).toBeLessThanOrEqual(32);
    expect(drafts.at(-1).trace.events.some((event: any) => event.phase === 'generating')).toBe(
      true
    );
  });

  it('updates an early incomplete draft when a later generation and idle transition is observed', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML = '<textarea></textarea><button aria-label="Send">Send</button>';
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const send = document.querySelector('button')!;
    send.click();
    const response = document.createElement('div');
    response.setAttribute('data-testid', 'markdown-reply');
    response.textContent = 'A response that appeared before activity was shown';
    Object.defineProperty(response, 'innerText', {
      value: response.textContent,
      configurable: true
    });
    document.body.append(response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(drafts[0]?.readyToSave).toBe(false);

    send.setAttribute('aria-label', 'Stop generating');
    await new Promise((resolve) => setTimeout(resolve, 150));
    send.setAttribute('aria-label', 'Send');
    await new Promise((resolve) => setTimeout(resolve, 3_100));
    session.stop();
    expect(drafts.at(-1)?.readyToSave).toBe(true);
    expect(drafts.at(-1)?.trace.observedGeneration).toBe(true);
  });

  it('uses a learned profile to capture a second Copilot-like request', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML =
      '<textarea aria-label="Message Copilot"></textarea><button aria-label="Send">Send</button>';
    const composer = document.querySelector('textarea')!;
    const send = document.querySelector('button')!;
    const drafts: any[] = [];
    let requestCount = 0;
    send.addEventListener('click', () => {
      requestCount += 1;
      send.setAttribute('aria-label', 'Stop generating');
      const response = document.createElement('div');
      response.setAttribute('data-testid', 'markdown-reply');
      response.setAttribute('data-message-id', `answer-${requestCount}`);
      response.textContent = `Partial ${requestCount}`;
      Object.defineProperty(response, 'innerText', {
        get: () => response.textContent,
        configurable: true
      });
      document.body.append(response);
      setTimeout(() => {
        response.textContent = `Final answer ${requestCount}`;
        send.setAttribute('aria-label', 'Send');
      }, 100);
    });

    const session = startProviderDiscovery((draft) => drafts.push(draft));
    composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    composer.value = 'Learning request';
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    send.click();
    await new Promise((resolve) => setTimeout(resolve, 3_250));
    session.stop();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].readyToSave).toBe(true);

    const adapter = createMcplabAdapter(drafts[0].profile);
    const result = await ask(adapter, 'Second request');
    expect(requestCount).toBe(2);
    expect(result).toBe('Final answer 2');
  });

  it('learns and executes a second request with a custom assistant message class', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML =
      '<textarea data-test="ai-agent_input"></textarea><button aria-label="Submit">Submit</button><div data-test="chat-messages_message" class="chat-messages__message--user">Old user prompt</div>';
    const composer = document.querySelector('textarea')!;
    const send = document.querySelector('button')!;
    const drafts: any[] = [];
    let requestCount = 0;
    send.addEventListener('click', () => {
      const request = ++requestCount;
      send.setAttribute('aria-label', 'Stop generating');
      const response = document.createElement('div');
      response.setAttribute('data-test', 'chat-messages_message');
      response.className = 'chat-messages__message--assistant';
      response.setAttribute('data-message-id', `answer-${request}`);
      response.textContent = `Partial custom response ${request}`;
      Object.defineProperty(response, 'innerText', {
        get: () => response.textContent,
        configurable: true
      });
      document.body.append(response);
      setTimeout(() => {
        response.textContent = `Final custom response ${request}`;
        send.setAttribute('aria-label', 'Submit');
      }, 100);
    });
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    composer.value = 'Learning request';
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    send.click();
    await vi.waitFor(() => expect(drafts.at(-1)?.readyToSave).toBe(true), { timeout: 3_500 });
    session.stop();
    const adapter = createMcplabAdapter(drafts.at(-1).profile);
    expect(await ask(adapter, 'Second request')).toBe('Final custom response 2');
  });

  it('does not anchor a repeated assistant turn to its first generated DOM id', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML = '<textarea></textarea><button aria-label="Send">Send</button>';
    const composer = document.querySelector('textarea')!;
    const send = document.querySelector('button')!;
    const drafts: any[] = [];
    let requestCount = 0;
    send.addEventListener('click', () => {
      const request = ++requestCount;
      send.setAttribute('aria-label', 'Stop generating');
      const response = document.createElement('article');
      response.id = `answer-${request}`;
      response.setAttribute('role', 'article');
      response.textContent = `Assistant answer for request ${request}`;
      Object.defineProperty(response, 'innerText', {
        get: () => response.textContent,
        configurable: true
      });
      document.body.append(response);
      setTimeout(() => send.setAttribute('aria-label', 'Send'), 100);
    });
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    composer.value = 'Learning request';
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    send.click();
    await vi.waitFor(() => expect(drafts.at(-1)?.readyToSave).toBe(true), { timeout: 3_500 });
    session.stop();
    expect(drafts.at(-1).profile.assistantMessages.locator.segments.at(-1)).toBe(
      '[role="article"]'
    );
    expect(await ask(createMcplabAdapter(drafts.at(-1).profile), 'Second request')).toBe(
      'Assistant answer for request 2'
    );
  });

  it('does not validate an old assistant node changing after Send as a new turn', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML =
      '<textarea></textarea><button aria-label="Send">Send</button><div data-testid="markdown-reply">Previous answer</div>';
    const response = document.querySelector('[data-testid="markdown-reply"]')!;
    Object.defineProperty(response, 'innerText', {
      get: () => response.textContent,
      configurable: true
    });
    const send = document.querySelector('button')!;
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    send.click();
    send.setAttribute('aria-label', 'Stop generating');
    response.textContent = 'Previous answer changed after Send';
    await new Promise((resolve) => setTimeout(resolve, 100));
    send.setAttribute('aria-label', 'Send');
    await vi.waitFor(() => expect(drafts.length).toBeGreaterThan(0), { timeout: 3_500 });
    session.stop();
    expect(drafts.at(-1)?.readyToSave).toBe(false);
    expect(drafts.at(-1)?.validationReasons).toContain(
      'Selected assistant response was not a new turn after submission.'
    );
  });

  it('does not accept a rerender of a pre-existing assistant turn with the same message id', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML =
      '<textarea></textarea><button aria-label="Send">Send</button><div data-testid="markdown-reply" data-message-id="old-turn">Old answer</div>';
    const send = document.querySelector('button')!;
    const drafts: any[] = [];
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    send.click();
    send.setAttribute('aria-label', 'Stop generating');
    const response = document.querySelector('[data-message-id="old-turn"]')!;
    response.outerHTML =
      '<div data-testid="markdown-reply" data-message-id="old-turn">Old answer rerendered after Send</div>';
    const replacement = document.querySelector('[data-message-id="old-turn"]')!;
    Object.defineProperty(replacement, 'innerText', {
      get: () => replacement.textContent,
      configurable: true
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    send.setAttribute('aria-label', 'Send');
    await vi.waitFor(() => expect(drafts.length).toBeGreaterThan(0), { timeout: 3_500 });
    session.stop();
    expect(drafts.at(-1)?.readyToSave).toBe(false);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('retains a selected Copilot markdown reply even when compact snapshots omit it', async () => {
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    const drafts: any[] = [];
    document.body.innerHTML =
      '<textarea aria-label="Message Copilot"></textarea><button aria-label="Send">Send</button>';
    const session = startProviderDiscovery((draft) => drafts.push(draft));
    const composer = document.querySelector('textarea')!;
    composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    document.querySelector('button')!.click();
    const reply = document.createElement('div');
    reply.setAttribute('data-testid', 'markdown-reply');
    reply.textContent = 'A Copilot answer from the selected assistant turn';
    Object.defineProperty(reply, 'innerText', {
      value: reply.textContent,
      configurable: true
    });
    document.body.append(reply);
    await new Promise((resolve) => setTimeout(resolve, 550));

    session.stop();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].profile.assistantMessages.locator.segments.at(-1)).toBe(
      '[data-testid="markdown-reply"]'
    );
    expect(
      drafts[0].trace.events.some((event: any) =>
        event.snapshot?.some((node: any) => node.selector === '[data-testid="markdown-reply"]')
      )
    ).toBe(false);
    expect(
      drafts[0].trace.events.some(
        (event: any) =>
          event.selectedElements?.assistant?.locator.segments.at(-1) ===
          '[data-testid="markdown-reply"]'
      )
    ).toBe(true);
    expect(
      drafts[0].trace.events.find((event: any) => event.selectedElements?.assistant)
        .selectedElements.assistant
    ).toMatchObject({
      candidateScore: 21,
      attributes: { testId: 'markdown-reply' },
      changedFromBaseline: true
    });
    expect(drafts[0].validationReasons).not.toContain(
      'Assistant selector was not observed in a response snapshot.'
    );
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
    const newChat = document.createElement('tm-icon-button');
    newChat.setAttribute('data-test', 'ai-agent_chat_new-chat');
    newChat.innerHTML = '<button title="New chat">add</button>';
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
    expect(drafts[0].profile.newConversation.locator.segments.at(-1)).toBe('[title="New chat"]');
    expect(drafts[0].capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'newConversation',
          confidence: 'low',
          detail: expect.stringContaining('not yet confirmed')
        })
      ])
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
    await new Promise((resolve) => setTimeout(resolve, 3_100));

    expect(drafts).toHaveLength(1);
    expect(drafts[0].trace.observedGeneration).toBe(true);
    expect(drafts[0].profile.completion.generatingLocator.segments.at(-1)).toContain(':disabled');
    expect(drafts[0].profile.completion.idleLocator.segments.at(-1)).toContain(':not([disabled])');
    session.stop();
  });

  it('does not treat an unrelated disabled control as generation', async () => {
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
    const save = document.createElement('button');
    save.textContent = 'Save';
    save.disabled = true;
    document.body.append(composer, save);
    composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const response = document.createElement('div');
    response.setAttribute('data-message-author-role', 'assistant');
    response.textContent = 'A completed answer';
    Object.defineProperty(response, 'innerText', {
      value: 'A completed answer',
      configurable: true
    });
    document.body.append(response);
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(drafts).toHaveLength(1);
    expect(drafts[0].trace.observedGeneration).toBe(false);
    expect(drafts[0].profile.completion.generatingLocator).toBeUndefined();
    session.stop();
  });

  it.each(['hidden', 'replaced', 'stop-hidden'])(
    'learns idle after generation ends with a %s send control',
    async (state) => {
      Object.defineProperty(globalThis, 'CSS', {
        value: { escape: (value: string) => value },
        configurable: true
      });
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 10,
        height: 10
      } as DOMRect);
      document.body.innerHTML =
        '<textarea aria-label="Enter a prompt for Gemini"></textarea><button aria-label="Send message"></button>';
      const drafts: any[] = [];
      const progress: any[] = [];
      const session = startProviderDiscovery(
        (draft) => drafts.push(draft),
        (update) => progress.push(update)
      );
      try {
        const composer = document.querySelector('textarea')!;
        const send = document.querySelector('button')!;
        composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        send.click();
        send.setAttribute('aria-label', 'Stop generating');
        const response = document.createElement('div');
        response.setAttribute('data-message-author-role', 'assistant');
        response.textContent = 'Hey there! How can I help you today?';
        Object.defineProperty(response, 'innerText', {
          value: response.textContent,
          configurable: true
        });
        document.body.append(response);
        await vi.waitFor(() => expect(progress.at(-1)?.generatingObserved).toBe(true));
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(drafts).toHaveLength(0);
        if (state !== 'replaced') {
          if (state === 'hidden') send.setAttribute('aria-label', 'Send message');
          send.style.display = 'none';
        } else {
          send.remove();
          document.body.insertAdjacentHTML('beforeend', '<button aria-label="Dictate"></button>');
        }
        await vi.waitFor(() => expect(drafts.at(-1)?.readyToSave).toBe(true), { timeout: 3_500 });
        expect(progress.at(-1)?.idleObserved).toBe(true);
        expect(drafts.at(-1)?.profile.completion.idleLocator).toBeUndefined();
        expect(drafts.at(-1)?.profile.submit.locator.segments.at(-1)).toBe(
          '[aria-label="Send message"]'
        );
        const adapter = createMcplabAdapter(drafts.at(-1).profile);
        expect(
          adapter.signalEvaluator.evaluate(adapter.getAssistantCandidates(), Date.now()).signals
        ).toMatchObject({ generation_active: false, idle_visible: true });
      } finally {
        session.stop();
      }
    }
  );

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
    await vi.waitFor(() => expect(drafts).toHaveLength(1), { timeout: 3_500 });
    session.stop();
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

describe('optional New Chat evidence', () => {
  let session: ReturnType<typeof startProviderDiscovery>;
  afterEach(() => {
    session?.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
    history.replaceState(null, '', '/');
  });

  async function learn(
    controlMarkup = '<button title="New chat">New chat</button>',
    shadow = false
  ) {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'CSS', {
      value: { escape: (value: string) => value },
      configurable: true
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 10,
      height: 10
    } as DOMRect);
    document.body.innerHTML =
      '<textarea></textarea><button aria-label="Send">Send</button>' + controlMarkup;
    const root = shadow
      ? document.body
          .appendChild(document.createElement('chat-host'))
          .attachShadow({ mode: 'open' })
      : document.body;
    const drafts: any[] = [];
    const progress: any[] = [];
    session = startProviderDiscovery(
      (draft) => drafts.push(draft),
      (update) => progress.push(update)
    );
    const composer = document.querySelector('textarea')!;
    composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const send = document.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
    send.click();
    send.setAttribute('aria-label', 'Stop generating');
    const response = document.createElement('div');
    response.setAttribute('data-message-author-role', 'assistant');
    response.textContent = 'A completed response';
    Object.defineProperty(response, 'innerText', { get: () => response.textContent });
    root.append(response);
    await vi.advanceTimersByTimeAsync(500);
    send.setAttribute('aria-label', 'Send');
    await vi.advanceTimersByTimeAsync(3000);
    expect(drafts.at(-1)?.readyToSave).toBe(true);
    return {
      drafts,
      progress,
      composer,
      response,
      root,
      control: document.querySelector<HTMLElement>('[title="New chat"]')!
    };
  }

  it('does not learn conversation titles or answer prose as New Chat controls', async () => {
    const { drafts } = await learn(
      '<a href="/c/old" tabindex="0">New chat</a><div tabindex="0">You can start a new conversation here</div><div title="New chat"><span>Sidebar title</span></div>'
    );
    expect(drafts.at(-1).profile.newConversation).toBeUndefined();
  });

  it('uses the same actionable descendant for capture and wrapper clicks', async () => {
    const { drafts, response, composer, root } = await learn(
      '<tm-icon-button data-test="ai-agent_chat_new-chat"><button>+</button></tm-icon-button>'
    );
    const wrapper = document.querySelector<HTMLElement>('tm-icon-button')!;
    wrapper.click();
    response.remove();
    await vi.advanceTimersByTimeAsync(1000);
    const saved = drafts.at(-1);
    expect(saved.trace.newConversationEvidence).toBeDefined();
    expect(saved.profile.newConversation.locator).toEqual(
      saved.trace.newConversationEvidence.controlLocator
    );
    expect(saved.profile.newConversation.locator.segments.at(-1)).toBe(
      '[data-test="ai-agent_chat_new-chat"] > button'
    );
    expect(saved.validationIssues).toEqual([]);
    root.append(response);
    composer.value = 'A second draft';
    wrapper.querySelector('button')!.addEventListener('click', () => {
      response.remove();
      composer.value = '';
    });
    await expect(
      createMcplabAdapter(saved.profile).startNewConversation!()
    ).resolves.toBeUndefined();
  });

  it.each(['new-chat-button', 'create-new-chat-button', 'sidebar_new_chat_btn', 'newChatButton'])(
    'discovers and executes an icon-only New Chat control with metadata %s',
    async (testId) => {
      const { drafts, response, composer, root } = await learn(
        `<button data-testid="${testId}">+</button>`
      );
      const control = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
      expect(drafts.at(-1).profile.newConversation).toBeDefined();
      control.click();
      response.remove();
      await vi.advanceTimersByTimeAsync(1000);
      const saved = drafts.at(-1);
      expect(saved.trace.newConversationEvidence).toBeDefined();
      expect(saved.validationIssues).toEqual([]);
      root.append(response);
      composer.value = 'Another prompt';
      control.addEventListener('click', () => {
        response.remove();
        composer.value = '';
      });
      await expect(
        createMcplabAdapter(saved.profile).startNewConversation!()
      ).resolves.toBeUndefined();
    }
  );

  it('expires pending clicks before a later unrelated transition and resets progress', async () => {
    const { drafts, progress, response, control } = await learn();
    control.click();
    await vi.advanceTimersByTimeAsync(5500);
    expect(progress.at(-1).newConversationClicked).toBe(false);
    response.remove();
    history.replaceState(null, '', '/c/old');
    await vi.advanceTimersByTimeAsync(1000);
    expect(drafts.at(-1).trace.newConversationEvidence).toBeUndefined();
  });

  it.each([
    'url-only',
    'hash-only',
    'nonempty-input',
    'partial-removal',
    'rerender',
    'sidebar-click'
  ])('does not confirm from %s', async (signal) => {
    const { drafts, composer, response, root, control } = await learn();
    const other = response.cloneNode(true);
    if (signal === 'partial-removal') root.append(other);
    control.click();
    if (signal === 'sidebar-click') {
      const sidebar = document.createElement('button');
      sidebar.textContent = 'Old conversation';
      document.body.append(sidebar);
      sidebar.click();
      response.remove();
    }
    if (signal === 'url-only') history.replaceState(null, '', '/c/old');
    if (signal === 'hash-only') history.replaceState(null, '', '/#new');
    if (signal === 'nonempty-input') composer.value = 'Unsent text';
    if (signal === 'nonempty-input' || signal === 'partial-removal') response.remove();
    if (signal === 'rerender') {
      response.remove();
      await vi.advanceTimersByTimeAsync(250);
      root.append(response.cloneNode(true));
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(drafts.at(-1).trace.newConversationEvidence).toBeUndefined();
  });

  it('counts the full shadow locator and ignores unrelated matching elements', async () => {
    const { drafts, response, control } = await learn(undefined, true);
    const unrelated = response.cloneNode(true) as HTMLElement;
    document.body.append(unrelated);
    control.click();
    unrelated.remove();
    await vi.advanceTimersByTimeAsync(1000);
    expect(drafts.at(-1).trace.newConversationEvidence).toBeUndefined();
    response.remove();
    await vi.advanceTimersByTimeAsync(1000);
    expect(drafts.at(-1).trace.newConversationEvidence).toMatchObject({
      beforeAssistantCount: 1,
      afterAssistantCount: 0
    });
  });

  it('confirms when visible responses become hidden while cached conversations remain in the DOM', async () => {
    const { drafts, response, root, control } = await learn();
    const cached = response.cloneNode(true) as HTMLElement;
    cached.style.display = 'none';
    root.append(cached);
    control.click();
    response.style.display = 'none';
    await vi.advanceTimersByTimeAsync(1000);
    expect(response.isConnected).toBe(true);
    expect(drafts.at(-1).trace.newConversationEvidence).toMatchObject({
      beforeAssistantCount: 1,
      afterAssistantCount: 0
    });
  });

  it('does not confirm a click that starts with only hidden cached responses', async () => {
    const { drafts, response, control } = await learn();
    response.style.display = 'none';
    control.click();
    response.remove();
    await vi.advanceTimersByTimeAsync(1000);
    expect(drafts.at(-1).trace.newConversationEvidence).toBeUndefined();
  });

  it('keeps learning when an unrelated answer link has a malformed URL', async () => {
    const { drafts } = await learn(
      '<button title="New chat">New chat</button><a href="http://[broken">An unrelated answer link</a>'
    );
    expect(drafts.at(-1).readyToSave).toBe(true);
    expect(drafts.at(-1).profile.newConversation.action).toBe('click');
  });

  it('learns a real New Chat link as navigation without requiring confirmation', async () => {
    const { drafts } = await learn('<a title="New chat" href="/new">New chat</a>');
    expect(drafts.at(-1).profile.newConversation).toMatchObject({
      action: 'navigate',
      url: new URL('/new', location.href).href
    });
    expect(drafts.at(-1).readyToSave).toBe(true);
    expect(drafts.at(-1).validationIssues).toContainEqual(
      expect.objectContaining({ code: 'new-chat-unconfirmed', blocking: false })
    );
  });

  it('uniquely saves the clicked control when labels are identical', async () => {
    const { drafts, response, root, composer } = await learn(
      '<button title="New chat" id="first">New chat</button><button title="New chat" id="second">New chat</button>'
    );
    const first = document.querySelector<HTMLButtonElement>('#first')!;
    const second = document.querySelector<HTMLButtonElement>('#second')!;
    second.click();
    response.remove();
    await vi.advanceTimersByTimeAsync(1000);
    const profile = drafts.at(-1).profile;
    expect(profile.newConversation.locator.segments).toEqual(['[id="second"]']);
    root.append(response);
    composer.value = 'A second draft';
    const firstClicked = vi.fn();
    first.addEventListener('click', firstClicked);
    second.addEventListener('click', () => {
      response.remove();
      composer.value = '';
    });
    await expect(createMcplabAdapter(profile).startNewConversation!()).resolves.toBeUndefined();
    expect(firstClicked).not.toHaveBeenCalled();
  });

  it('saves the actually clicked candidate as the primary locator', async () => {
    const { drafts, response } = await learn(
      '<button title="New chat" id="first">New chat</button><button aria-label="New conversation" id="second">New conversation</button>'
    );
    document.querySelector<HTMLElement>('#second')!.click();
    response.remove();
    await vi.advanceTimersByTimeAsync(1000);
    expect(drafts.at(-1).profile.newConversation.locator.segments).toEqual([
      '[aria-label="New conversation"]'
    ]);
  });
});
