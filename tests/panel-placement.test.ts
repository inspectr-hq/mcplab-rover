// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BADGE_POSITION_KEY,
  enablePanelPlacement,
  fromStoredPosition,
  placePanel,
  toStoredPosition
} from '../src/panel-placement';

const viewport = { width: 1000, height: 800 };

describe('panel placement geometry', () => {
  it.each([
    [
      { left: 900, top: 100 },
      { horizontal: 'right', x: 58, vertical: 'top', y: 100 }
    ],
    [
      { left: 50, top: 100 },
      { horizontal: 'left', x: 50, vertical: 'top', y: 100 }
    ],
    [
      { left: 900, top: 700 },
      { horizontal: 'right', x: 58, vertical: 'bottom', y: 58 }
    ],
    [
      { left: 50, top: 700 },
      { horizontal: 'left', x: 50, vertical: 'bottom', y: 58 }
    ]
  ])('opens a badge at %o toward the free space', (badge, expected) => {
    expect(placePanel(badge, viewport, 300)).toEqual(expected);
  });

  it('keeps the open panel inside the viewport', () => {
    expect(placePanel({ left: 400, top: 0 }, viewport, 300)).toMatchObject({
      horizontal: 'left',
      x: 400,
      vertical: 'top',
      y: 12
    });
    // A badge near the vertical middle cannot push a tall panel off screen.
    expect(placePanel({ left: 0, top: 380 }, viewport, 700)).toMatchObject({
      vertical: 'bottom',
      y: 88
    });
    expect(placePanel({ left: 600, top: 100 }, { width: 800, height: 800 }, 300).x).toBe(158);
  });

  it('stores distances from the nearest edges and restores them after a resize', () => {
    const stored = toStoredPosition({ left: 900, top: 700 }, viewport);
    expect(stored).toEqual({ horizontal: 'right', x: 58, vertical: 'bottom', y: 58 });
    expect(fromStoredPosition(stored, { width: 1400, height: 900 })).toEqual({
      left: 1300,
      top: 800
    });
  });

  it('brings a saved position back on screen in a smaller window', () => {
    expect(
      fromStoredPosition({ horizontal: 'left', x: 1200, vertical: 'top', y: 900 }, viewport)
    ).toEqual({ left: 958, top: 758 });
  });
});

describe('badge dragging', () => {
  let storage: Record<string, unknown>;
  let host: HTMLElement;
  let badge: HTMLButtonElement;
  let style: HTMLStyleElement;
  let disable: () => void;
  let clicks: number;

  const pointer = (type: string, clientX: number, clientY: number) =>
    badge.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY }));
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function mount() {
    host = document.createElement('div');
    badge = document.createElement('button');
    style = document.createElement('style');
    style.textContent = ':host {}';
    host.append(badge);
    document.body.append(host);
    badge.getBoundingClientRect = () => ({ left: 900, top: 140, width: 34, height: 34 }) as DOMRect;
    disable = enablePanelPlacement(host, badge, style);
    clicks = 0;
    badge.addEventListener('click', () => {
      clicks += 1;
      host.classList.toggle('expanded');
    });
  }

  beforeEach(() => {
    storage = {};
    Object.assign(window, { innerWidth: 1000, innerHeight: 800 });
    (globalThis as typeof globalThis & { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => (key in storage ? { [key]: storage[key] } : {})),
          set: vi.fn(async (values: Record<string, unknown>) => {
            Object.assign(storage, values);
          })
        }
      }
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    disable();
    document.body.replaceChildren();
  });

  it('keeps the default stylesheet placement until the badge is dragged', async () => {
    mount();
    await flush();
    host.classList.add('expanded');
    await flush();
    expect(host.getAttribute('style')).toBeNull();
    expect(style.textContent).toContain('anchor-left');
  });

  it('moves the badge, saves one global position and swallows the drag click', async () => {
    mount();
    pointer('pointerdown', 917, 157);
    pointer('pointermove', 517, 657);
    pointer('pointerup', 517, 657);
    badge.click();
    await flush();
    expect(clicks).toBe(0);
    expect(host.style.left).toBe('496px');
    expect(host.style.top).toBe('657px');
    expect(host.style.right).toBe('auto');
    expect(storage[BADGE_POSITION_KEY]).toEqual({
      horizontal: 'right',
      x: 462,
      vertical: 'bottom',
      y: 122
    });
    badge.click();
    expect(clicks).toBe(1);
  });

  it('treats a small pointer wobble as a click', async () => {
    mount();
    pointer('pointerdown', 917, 157);
    pointer('pointermove', 919, 158);
    pointer('pointerup', 919, 158);
    badge.click();
    await flush();
    expect(clicks).toBe(1);
    expect(storage[BADGE_POSITION_KEY]).toBeUndefined();
  });

  it('restores the saved position and opens toward the free space', async () => {
    storage[BADGE_POSITION_KEY] = { horizontal: 'left', x: 40, vertical: 'bottom', y: 60 };
    mount();
    await flush();
    expect(host.style.left).toBe('40px');
    expect(host.style.top).toBe('719px');
    host.style.height = '320px';
    host.classList.add('expanded');
    await flush();
    expect(host.style.left).toBe('40px');
    expect(host.style.right).toBe('auto');
    expect(host.style.bottom).toBe('60px');
    expect(host.style.top).toBe('auto');
    expect(host.classList.contains('anchor-left')).toBe(true);
    expect(host.classList.contains('anchor-bottom')).toBe(true);
    host.classList.remove('expanded');
    await flush();
    expect(host.style.top).toBe('719px');
    expect(host.classList.contains('anchor-bottom')).toBe(false);
  });

  it('does not drag the open panel', async () => {
    mount();
    host.classList.add('expanded');
    pointer('pointerdown', 917, 157);
    pointer('pointermove', 517, 657);
    pointer('pointerup', 517, 657);
    await flush();
    expect(storage[BADGE_POSITION_KEY]).toBeUndefined();
  });

  it('ignores an invalid saved position', async () => {
    storage[BADGE_POSITION_KEY] = { horizontal: 'middle', x: 'far' };
    mount();
    await flush();
    expect(host.getAttribute('style')).toBeNull();
  });
});
