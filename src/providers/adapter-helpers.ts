import type { DebugElementCheck } from '../contracts';
import { composerValue, isVisible } from './dom';

export function first<T extends Element>(selectors: string[]): T | null {
  for (const selector of selectors) {
    const element = document.querySelector<T>(selector);
    if (element) return element;
  }
  return null;
}

export function debugCheck(
  id: string,
  label: string,
  selectors: string | string[]
): DebugElementCheck {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const present = Boolean(first<HTMLElement>(list));
  return {
    id,
    label,
    present,
    detail: present ? 'Found matching element' : 'Element not found',
    selector: list.join(', ')
  };
}

export function pageAlertText(): string | null {
  return document.querySelector('[role="alert"]')?.textContent?.trim() || null;
}

export async function waitForNewConversation(options: {
  findComposer: () => HTMLElement | null;
  messageCount: () => number;
  start: () => void;
  providerName: string;
  confirmation?: 'context-change' | 'empty-chat';
}): Promise<void> {
  const initialComposer = options.findComposer();
  const beforeText = initialComposer ? composerValue(initialComposer).trim() : '';
  const beforeMessageCount = options.messageCount();
  const beforeUrl = location.href;
  options.start();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const composer = options.findComposer();
    const messageCount = options.messageCount();
    const contextChanged = messageCount < beforeMessageCount || location.href !== beforeUrl;
    const draftCleared = Boolean(beforeText && composer && !composerValue(composer).trim());
    const confirmed =
      options.confirmation === 'context-change'
        ? contextChanged
        : options.confirmation === 'empty-chat'
          ? messageCount === 0 &&
            Boolean(composer && isVisible(composer)) &&
            (contextChanged ||
              composer !== initialComposer ||
              (beforeMessageCount === 0 && draftCleared))
          : contextChanged || draftCleared;
    if (composer && !composerValue(composer).trim() && confirmed) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${options.providerName} new conversation did not become ready`);
}
