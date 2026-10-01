export function controlLabel(element: Element): string {
  return `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''} ${element.textContent ?? ''}`.toLowerCase();
}

export function isGenerationControlLabel(label: string): boolean {
  return /\b(stop|cancel|abort)\b/.test(label);
}
