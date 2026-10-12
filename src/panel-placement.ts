/**
 * Draggable Rover badge and space-aware panel placement.
 * Kept in one module so the feature can be reverted without touching panel behavior.
 * Without a saved position, the panel keeps its default stylesheet placement.
 */
export const BADGE_POSITION_KEY = 'rover.badgePosition';
const BADGE_SIZE = 42;
const PANEL_WIDTH = 390;
const DEFAULT_PANEL_HEIGHT = 300;
const MARGIN = 12;
const DRAG_THRESHOLD = 4;

export interface Viewport {
  width: number;
  height: number;
}

/** Top-left corner of the collapsed badge, in viewport pixels. */
export interface BadgePoint {
  left: number;
  top: number;
}

/** Distances from the nearest edges, so a dropped badge stays put when the window resizes. */
export interface StoredBadgePosition {
  horizontal: 'left' | 'right';
  x: number;
  vertical: 'top' | 'bottom';
  y: number;
}

export interface PanelPlacement {
  horizontal: 'left' | 'right';
  x: number;
  vertical: 'top' | 'bottom';
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function clampBadge(point: BadgePoint, viewport: Viewport): BadgePoint {
  return {
    left: clamp(point.left, 0, viewport.width - BADGE_SIZE),
    top: clamp(point.top, 0, viewport.height - BADGE_SIZE)
  };
}

export function toStoredPosition(point: BadgePoint, viewport: Viewport): StoredBadgePosition {
  const { left, top } = clampBadge(point, viewport);
  const right = viewport.width - left - BADGE_SIZE;
  const bottom = viewport.height - top - BADGE_SIZE;
  return {
    horizontal: left <= right ? 'left' : 'right',
    x: Math.round(Math.min(left, right)),
    vertical: top <= bottom ? 'top' : 'bottom',
    y: Math.round(Math.min(top, bottom))
  };
}

export function fromStoredPosition(stored: StoredBadgePosition, viewport: Viewport): BadgePoint {
  return clampBadge(
    {
      left: stored.horizontal === 'left' ? stored.x : viewport.width - BADGE_SIZE - stored.x,
      top: stored.vertical === 'top' ? stored.y : viewport.height - BADGE_SIZE - stored.y
    },
    viewport
  );
}

/** Open toward the side with more room, aligned with the badge, and kept inside the viewport. */
export function placePanel(
  badge: BadgePoint,
  viewport: Viewport,
  panelHeight: number
): PanelPlacement {
  const right = viewport.width - badge.left - BADGE_SIZE;
  const bottom = viewport.height - badge.top - BADGE_SIZE;
  const horizontal = badge.left + BADGE_SIZE / 2 >= viewport.width / 2 ? 'right' : 'left';
  const vertical = badge.top + BADGE_SIZE / 2 >= viewport.height / 2 ? 'bottom' : 'top';
  const maxX = viewport.width - PANEL_WIDTH - MARGIN;
  const maxY = viewport.height - panelHeight - MARGIN;
  return {
    horizontal,
    x: clamp(horizontal === 'right' ? right : badge.left, MARGIN, maxX),
    vertical,
    y: clamp(vertical === 'bottom' ? bottom : badge.top, MARGIN, maxY)
  };
}

function isStoredPosition(value: unknown): value is StoredBadgePosition {
  const position = value as Partial<StoredBadgePosition> | null;
  return Boolean(
    position &&
    (position.horizontal === 'left' || position.horizontal === 'right') &&
    (position.vertical === 'top' || position.vertical === 'bottom') &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y)
  );
}

// The collapsed host keeps the hidden panel height, so only the badge may receive pointer
// events; otherwise a badge dropped mid-page leaves an invisible strip that blocks the page.
const PLACEMENT_STYLE = `
  :host(:not(.expanded)) { pointer-events: none; }
  :host(:not(.expanded)) button { pointer-events: auto; }
  :host(.rover-dragging) { transition: none; }
  :host(.rover-dragging) button { cursor: grabbing; }
  :host(.expanded.anchor-left) iframe { border-radius: 8px 20px 20px 20px; }
  :host(.expanded.anchor-bottom) iframe { border-radius: 20px 20px 8px 20px; }
  :host(.expanded.anchor-left.anchor-bottom) iframe { border-radius: 20px 20px 20px 8px; }
`;

/** Call before other badge click listeners so a drag can suppress the click that ends it. */
export function enablePanelPlacement(
  host: HTMLElement,
  badge: HTMLElement,
  style: HTMLStyleElement
): () => void {
  style.textContent += PLACEMENT_STYLE;
  let stored: StoredBadgePosition | null = null;
  let drag: {
    pointerId: number;
    startX: number;
    startY: number;
    origin: BadgePoint;
    moved: boolean;
  } | null = null;
  let suppressClick = false;
  let lastExpanded: boolean | undefined;
  let lastHeight: string | undefined;
  let disposed = false;

  const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });

  const setPosition = (styles: Record<'left' | 'right' | 'top' | 'bottom', string>) => {
    for (const [property, value] of Object.entries(styles)) host.style.setProperty(property, value);
  };

  const apply = () => {
    if (!stored || disposed) return;
    const badgePoint = fromStoredPosition(stored, viewport());
    if (host.classList.contains('expanded')) {
      const height = Number.parseFloat(host.style.height) || DEFAULT_PANEL_HEIGHT;
      const placement = placePanel(badgePoint, viewport(), height);
      setPosition({
        left: placement.horizontal === 'left' ? `${placement.x}px` : 'auto',
        right: placement.horizontal === 'right' ? `${placement.x}px` : 'auto',
        top: placement.vertical === 'top' ? `${placement.y}px` : 'auto',
        bottom: placement.vertical === 'bottom' ? `${placement.y}px` : 'auto'
      });
      host.classList.toggle('anchor-left', placement.horizontal === 'left');
      host.classList.toggle('anchor-bottom', placement.vertical === 'bottom');
      return;
    }
    // The collapsed host can be as tall as the hidden panel; its stylesheet centers the badge
    // with translateY(-50%), so position the host by the badge center.
    setPosition({
      left: `${badgePoint.left}px`,
      right: 'auto',
      top: `${badgePoint.top + BADGE_SIZE / 2}px`,
      bottom: 'auto'
    });
    host.classList.remove('anchor-left', 'anchor-bottom');
  };

  // Placement writes inline styles too, so react only to expansion and panel height changes.
  const observer = new MutationObserver(() => {
    const expanded = host.classList.contains('expanded');
    const height = host.style.height;
    if (expanded === lastExpanded && height === lastHeight) return;
    lastExpanded = expanded;
    lastHeight = height;
    apply();
  });
  observer.observe(host, { attributes: true, attributeFilter: ['class', 'style'] });
  window.addEventListener('resize', apply);

  const currentBadgePoint = (): BadgePoint => {
    const rect = badge.getBoundingClientRect();
    return {
      left: rect.left + rect.width / 2 - BADGE_SIZE / 2,
      top: rect.top + rect.height / 2 - BADGE_SIZE / 2
    };
  };

  badge.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0 || host.classList.contains('expanded')) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: stored ? fromStoredPosition(stored, viewport()) : currentBadgePoint(),
      moved: false
    };
    badge.setPointerCapture?.(event.pointerId);
  });
  badge.addEventListener('pointermove', (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    host.classList.add('rover-dragging');
    stored = toStoredPosition(
      { left: drag.origin.left + dx, top: drag.origin.top + dy },
      viewport()
    );
    apply();
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    drag = null;
    host.classList.remove('rover-dragging');
    if (!moved || !stored) return;
    suppressClick = event.type === 'pointerup';
    void chrome.storage.local.set({ [BADGE_POSITION_KEY]: stored }).catch(() => undefined);
  };
  badge.addEventListener('pointerup', endDrag);
  badge.addEventListener('pointercancel', endDrag);
  badge.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true }
  );

  void Promise.resolve()
    .then(() => chrome.storage.local.get(BADGE_POSITION_KEY))
    .then((result) => {
      const value = result?.[BADGE_POSITION_KEY];
      // A drag that finished before storage answered takes precedence.
      if (!stored && isStoredPosition(value)) {
        stored = value;
        apply();
      }
    })
    .catch(() => undefined);

  return () => {
    disposed = true;
    observer.disconnect();
    window.removeEventListener('resize', apply);
  };
}
