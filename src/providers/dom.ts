export function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  );
}

export function setTextValue(element: HTMLElement, value: string): void {
  element.focus();
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
    setter?.call(element, value);
  } else {
    element.textContent = value;
  }
  element.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })
  );
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export function textFrom(element: Element): string {
  return (element as HTMLElement).innerText || element.textContent || '';
}
