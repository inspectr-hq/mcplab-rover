export function stableTurnIdentity(element: Element): string | undefined {
  for (const attribute of ['data-message-id', 'data-turn-id', 'data-id', 'id']) {
    const value = element.getAttribute(attribute);
    if (value) return `${attribute}:${value}`;
  }
  return undefined;
}
