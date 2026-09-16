// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startProviderDiscovery } from '../src/providers/provider-discovery';

describe('provider discovery recovery', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('emits a profile when a response appeared before the composer was detected', async () => {
    Object.defineProperty(globalThis, 'CSS', { value: { escape: (value: string) => value }, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 10, height: 10 } as DOMRect);
    const drafts: unknown[] = [];
    const stop = startProviderDiscovery((draft) => drafts.push(draft));
    const send = document.createElement('button');
    send.textContent = 'Send';
    document.body.append(send);
    send.click();
    const response = document.createElement('div');
    response.setAttribute('data-message-author-role', 'assistant');
    response.textContent = 'A newly discovered answer';
    Object.defineProperty(response, 'innerText', { value: 'A newly discovered answer', configurable: true });
    document.body.append(response);
    await new Promise((resolve) => setTimeout(resolve, 550));

    const composer = document.createElement('textarea');
    document.body.append(composer);
    composer.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(drafts).toHaveLength(1);
    stop();
  });
});
