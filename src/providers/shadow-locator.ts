import type { ShadowLocator } from '../mcplab/types';

/** Traverse shadow hosts or light DOM ancestors, keeping each next query inside its owner. */
export function queryShadowLocator(locator: ShadowLocator): HTMLElement[] {
  let roots: Array<Document | ShadowRoot | HTMLElement> = [document];
  for (const [index, selector] of locator.segments.entries()) {
    const matches = roots.flatMap((root) =>
      Array.from(root.querySelectorAll<HTMLElement>(selector))
    );
    if (index === locator.segments.length - 1) return [...new Set(matches)];
    roots = matches.map((match) => match.shadowRoot ?? match);
  }
  return [];
}
