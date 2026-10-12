/**
 * Contrasting Rover badge: light on dark pages, dark on light pages.
 * Kept in one module so the feature can be reverted without touching panel behavior.
 */
const LIGHT_CLASS = 'rover-badge-light';
/** Luminance where black and white text have equal contrast (WCAG). */
const DARK_LUMINANCE = 0.179;

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const RGB_PATTERN =
  /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;

export function parseRgb(value: string): Rgba | null {
  const match = RGB_PATTERN.exec(value.trim());
  if (!match) return null;
  const alpha = match[4]?.endsWith('%')
    ? Number.parseFloat(match[4]) / 100
    : Number.parseFloat(match[4] ?? '1');
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: alpha };
}

export function relativeLuminance({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The first mostly opaque background behind a point, ignoring the Rover host itself. */
export function backgroundBehind(x: number, y: number, host: HTMLElement): Rgba | null {
  const target = (document.elementsFromPoint?.(x, y) ?? []).find(
    (element) => element !== host && !host.contains(element)
  );
  for (let element: Element | null = target ?? null; element; element = element.parentElement) {
    const color = parseRgb(getComputedStyle(element).backgroundColor);
    if (color && color.a >= 0.5) return color;
  }
  return null;
}

/** Without a painted background, the canvas is dark only when the page opts into dark mode. */
export function pageCanvasIsDark(colorScheme: string, prefersDark: boolean): boolean {
  const schemes = colorScheme.split(/\s+/);
  return schemes.includes('dark') && (!schemes.includes('light') || prefersDark);
}

export function shouldUseLightBadge(background: Rgba | null, canvasIsDark: boolean): boolean {
  return background ? relativeLuminance(background) < DARK_LUMINANCE : canvasIsDark;
}

const THEME_STYLE = `
  :host(.${LIGHT_CLASS}:not(.expanded)) button { background: #f5f5f4; box-shadow: 0 0 0 4px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.18); }
  :host(.${LIGHT_CLASS}:not(.expanded)) button span { box-shadow: 0 0 0 2px #f5f5f4; }
  :host(.${LIGHT_CLASS}:not(.expanded)) button[data-connected="true"] span { box-shadow: 0 0 8px rgba(66,211,146,.8), 0 0 0 2px #f5f5f4; }
`;

export function enableBadgeTheme(
  host: HTMLElement,
  badge: HTMLElement,
  style: HTMLStyleElement
): () => void {
  style.textContent += THEME_STYLE;
  const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  const requestFrame =
    window.requestAnimationFrame?.bind(window) ??
    ((callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 16));
  const cancelFrame = window.cancelAnimationFrame?.bind(window) ?? window.clearTimeout;
  let frame = 0;

  const update = () => {
    frame = 0;
    if (!host.isConnected || host.classList.contains('expanded')) return;
    const rect = badge.getBoundingClientRect();
    const background = backgroundBehind(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      host
    );
    const canvasIsDark = pageCanvasIsDark(
      getComputedStyle(document.documentElement).colorScheme ?? '',
      darkQuery?.matches === true
    );
    host.classList.toggle(LIGHT_CLASS, shouldUseLightBadge(background, canvasIsDark));
  };
  const schedule = () => {
    if (!frame) frame = requestFrame(update);
  };

  // Recheck when the badge moves or collapses, and when the page switches theme or scrolls.
  const hostObserver = new MutationObserver(schedule);
  hostObserver.observe(host, { attributes: true, attributeFilter: ['class', 'style'] });
  const pageObserver = new MutationObserver(schedule);
  for (const element of [document.documentElement, document.body]) {
    if (element)
      pageObserver.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode', 'data-mode']
      });
  }
  darkQuery?.addEventListener?.('change', schedule);
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule);
  schedule();

  return () => {
    if (frame) cancelFrame(frame);
    hostObserver.disconnect();
    pageObserver.disconnect();
    darkQuery?.removeEventListener?.('change', schedule);
    window.removeEventListener('scroll', schedule, { capture: true });
    window.removeEventListener('resize', schedule);
  };
}
