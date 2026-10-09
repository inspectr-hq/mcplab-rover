import { isVisible } from './dom';

export const NEW_CONVERSATION_CANDIDATES =
  'button,[role="button"],a,[tabindex]:not([tabindex="-1"]),[aria-label],[title],[data-test],[data-testid],[trackingtest]';

const newConversationLabel =
  /^(?:new (?:chat|conversation|thread)|start (?:a )?new (?:chat|conversation|thread))(?:\s*\([^)]{0,40}\))?$/i;

function normalized(value: string): string {
  return value.trim().replace(/[\s_-]+/g, ' ');
}

function hasExplicitLabel(element: HTMLElement): boolean {
  if (
    ['aria-label', 'title'].some((attribute) =>
      newConversationLabel.test(normalized(element.getAttribute(attribute) ?? ''))
    )
  )
    return true;
  return ['data-test', 'data-testid', 'trackingtest'].some((attribute) => {
    const value = (element.getAttribute(attribute) ?? '')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    const words = normalized(value).split(' ');
    // Button suffixes name the action; menu and container suffixes do not.
    if (/^(?:button|btn)$/i.test(words.at(-1) ?? '')) words.pop();
    return [2, 3, 4, 5].some((length) => newConversationLabel.test(words.slice(-length).join(' ')));
  });
}

function anonymousControl(element: HTMLElement): boolean {
  return (
    !['aria-label', 'title'].some((attribute) => element.getAttribute(attribute)?.trim()) &&
    !/[\p{L}\p{N}]/u.test(element.textContent ?? '')
  );
}

function actionable(element: HTMLElement): boolean {
  return element.matches('button,a,[role="button"]');
}

function enabled(element: HTMLElement): boolean {
  return (
    isVisible(element) &&
    element.getAttribute('aria-disabled') !== 'true' &&
    !(element instanceof HTMLButtonElement && element.disabled)
  );
}

function existingConversationLink(element: HTMLElement): boolean {
  if (!(element instanceof HTMLAnchorElement) || !element.getAttribute('href')) return false;
  try {
    const path = new URL(element.href, location.href).pathname;
    return /\/(?:c|chat|chats|conversation|conversations|thread|threads)\/(?!new(?:\/|$))[^/]+/i.test(
      path
    );
  } catch {
    // A malformed answer/sidebar link cannot be a usable New Chat target.
    return true;
  }
}

function labelled(element: HTMLElement): boolean {
  if (existingConversationLink(element)) return false;
  if (hasExplicitLabel(element)) return true;
  const text = element.textContent?.trim() ?? '';
  return actionable(element) && text.length <= 80 && newConversationLabel.test(normalized(text));
}

function descendants(element: HTMLElement): HTMLElement[] {
  const collect = (root: Element | ShadowRoot): HTMLElement[] => [
    ...Array.from(root.querySelectorAll<HTMLElement>('button,a,[role="button"]')),
    ...Array.from(root.querySelectorAll<HTMLElement>('*')).flatMap((node) =>
      node.shadowRoot ? collect(node.shadowRoot) : []
    )
  ];
  return [...collect(element), ...(element.shadowRoot ? collect(element.shadowRoot) : [])];
}

function parentControl(element: HTMLElement): HTMLElement | null {
  const root = element.getRootNode();
  return element.parentElement ?? (root instanceof ShadowRoot ? (root.host as HTMLElement) : null);
}

/** Resolve labels and inherited wrapper labels to the same actionable target everywhere. */
export function resolveNewConversationControl(element: HTMLElement): HTMLElement | null {
  if (!enabled(element) || existingConversationLink(element)) return null;
  if (labelled(element)) {
    if (actionable(element)) return element;
    const allChildren = descendants(element);
    const children = allChildren.filter(
      (child) => enabled(child) && !existingConversationLink(child)
    );
    const labelledChildren = children.filter(labelled);
    if (labelledChildren.length === 1) return labelledChildren[0];
    if (labelledChildren.length > 1) return null;
    if (children.length === 1 && anonymousControl(children[0])) return children[0];
    // Only custom elements and explicit keyboard controls are actionable without children.
    return allChildren.length === 0 &&
      (element.tagName.includes('-') || element.hasAttribute('tabindex'))
      ? element
      : null;
  }
  if (!actionable(element)) return null;
  for (let parent = parentControl(element); parent; parent = parentControl(parent)) {
    if (hasExplicitLabel(parent) && resolveNewConversationControl(parent) === element)
      return element;
  }
  return null;
}

/** A label source is used to scope an otherwise anonymous child locator. */
export function newConversationLabelSource(element: HTMLElement): HTMLElement {
  if (labelled(element)) return element;
  for (let parent = parentControl(element); parent; parent = parentControl(parent)) {
    if (hasExplicitLabel(parent) && resolveNewConversationControl(parent) === element)
      return parent;
  }
  return element;
}

export function newConversationTargetUrl(element: HTMLElement): string | undefined {
  if (!(element instanceof HTMLAnchorElement)) return undefined;
  const href = element.getAttribute('href')?.trim();
  if (!href || href.startsWith('#')) return undefined;
  try {
    const url = new URL(element.href, location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
