// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backgroundBehind,
  enableBadgeTheme,
  pageCanvasIsDark,
  parseRgb,
  shouldUseLightBadge
} from '../src/badge-theme';

describe('badge theme decisions', () => {
  it.each([
    ['rgb(33, 33, 33)', { r: 33, g: 33, b: 33, a: 1 }],
    ['rgba(255, 255, 255, 0.4)', { r: 255, g: 255, b: 255, a: 0.4 }],
    ['rgb(10 20 30 / 50%)', { r: 10, g: 20, b: 30, a: 0.5 }],
    ['oklch(0.2 0 0)', null]
  ])('parses %s', (value, expected) => {
    expect(parseRgb(value)).toEqual(expected);
  });

  it.each([
    [{ r: 33, g: 33, b: 33, a: 1 }, false, true],
    [{ r: 52, g: 53, b: 65, a: 1 }, false, true],
    [{ r: 255, g: 255, b: 255, a: 1 }, true, false],
    [{ r: 244, g: 244, b: 245, a: 1 }, true, false],
    [null, true, true],
    [null, false, false]
  ])('uses a light badge on %o (dark canvas %s): %s', (background, canvasIsDark, light) => {
    expect(shouldUseLightBadge(background, canvasIsDark)).toBe(light);
  });

  it.each([
    ['normal', true, false],
    ['dark', false, true],
    ['light dark', true, true],
    ['light dark', false, false]
  ])('treats color-scheme "%s" (prefers dark %s) as a dark canvas: %s', (scheme, prefers, dark) => {
    expect(pageCanvasIsDark(scheme, prefers)).toBe(dark);
  });
});

describe('badge theme in the page', () => {
  let disable: (() => void) | undefined;
  afterEach(() => {
    disable?.();
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.body.removeAttribute('style');
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
  });

  function mount(behind: Element) {
    const host = document.createElement('div');
    const badge = document.createElement('button');
    const style = document.createElement('style');
    style.textContent = '';
    host.append(badge);
    document.body.append(host);
    Object.assign(document, { elementsFromPoint: vi.fn(() => [host, behind]) });
    return { host, badge, style };
  }

  it('finds the first opaque background behind the badge, skipping the Rover host', () => {
    const page = document.createElement('main');
    page.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
    const content = document.createElement('p');
    page.append(content);
    document.body.append(page);
    document.body.style.backgroundColor = 'rgb(20, 20, 20)';
    const { host } = mount(content);
    expect(backgroundBehind(10, 10, host)).toEqual({ r: 20, g: 20, b: 20, a: 1 });
  });

  it('switches the badge when the page theme changes', async () => {
    const page = document.createElement('main');
    page.style.backgroundColor = 'rgb(255, 255, 255)';
    document.body.append(page);
    const { host, badge, style } = mount(page);
    disable = enableBadgeTheme(host, badge, style);
    await vi.waitFor(() => expect(host.classList.contains('rover-badge-light')).toBe(false));
    expect(style.textContent).toContain('rover-badge-light');

    page.style.backgroundColor = 'rgb(33, 33, 33)';
    document.documentElement.classList.add('dark');
    await vi.waitFor(() => expect(host.classList.contains('rover-badge-light')).toBe(true));
    document.documentElement.classList.remove('dark');
  });

  it('keeps the current theme while the panel is open', async () => {
    const page = document.createElement('main');
    page.style.backgroundColor = 'rgb(33, 33, 33)';
    document.body.append(page);
    const { host, badge, style } = mount(page);
    host.classList.add('expanded');
    disable = enableBadgeTheme(host, badge, style);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(host.classList.contains('rover-badge-light')).toBe(false);
    host.classList.remove('expanded');
    await vi.waitFor(() => expect(host.classList.contains('rover-badge-light')).toBe(true));
  });
});
