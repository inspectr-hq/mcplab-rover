import type { DebugElementCheck } from '../contracts';

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
