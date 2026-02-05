type ZoomHook = {
  onZoom?: (zoom: number) => void;
};

const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

let currentZoom = DEFAULT_ZOOM;
let viewportEl: HTMLElement | null = null;
let contentEl: HTMLElement | null = null;
let zoomHook: ZoomHook | null = null;
let wheelHandler: ((event: WheelEvent) => void) | null = null;

export function initFreeformZoom(viewport: HTMLElement, content: HTMLElement, hook: ZoomHook = {}): void {
  if (viewportEl && wheelHandler && viewportEl !== viewport) {
    viewportEl.removeEventListener('wheel', wheelHandler);
  }

  viewportEl = viewport;
  contentEl = content;
  zoomHook = hook;
  applyZoom(currentZoom, getViewportCenter());

  if (!wheelHandler) {
    wheelHandler = (event: WheelEvent) => {
      if (!viewportEl) return;
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (event.deltaY === 0) return;
      const direction = event.deltaY < 0 ? 1 : -1;
      const rect = viewportEl.getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      zoomBy(direction * ZOOM_STEP, anchor);
    };
  }

  viewport.addEventListener('wheel', wheelHandler, { passive: false });
}

export function destroyFreeformZoom(): void {
  if (viewportEl && wheelHandler) {
    viewportEl.removeEventListener('wheel', wheelHandler);
  }
  viewportEl = null;
  contentEl = null;
  zoomHook = null;
}

export function getFreeformZoom(): number {
  return currentZoom;
}

export function getFreeformContentRect(): DOMRect | null {
  return contentEl?.getBoundingClientRect() ?? null;
}

export function clientToContentPoint(clientX: number, clientY: number): { x: number; y: number } {
  if (!contentEl) return { x: 0, y: 0 };
  const rect = contentEl.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / currentZoom,
    y: (clientY - rect.top) / currentZoom,
  };
}

export function zoomIn(anchor?: { x: number; y: number }): void {
  zoomBy(ZOOM_STEP, anchor ?? getViewportCenter());
}

export function zoomOut(anchor?: { x: number; y: number }): void {
  zoomBy(-ZOOM_STEP, anchor ?? getViewportCenter());
}

export function resetFreeformZoom(anchor?: { x: number; y: number }): void {
  applyZoom(DEFAULT_ZOOM, anchor ?? getViewportCenter());
}

function zoomBy(delta: number, anchor?: { x: number; y: number }): void {
  applyZoom(currentZoom + delta, anchor ?? getViewportCenter());
}

function applyZoom(nextZoom: number, anchor?: { x: number; y: number }): void {
  if (!viewportEl) {
    currentZoom = clamp(nextZoom);
    return;
  }

  const prevZoom = currentZoom;
  const clamped = clamp(nextZoom);
  if (clamped === prevZoom && viewportEl.style.getPropertyValue('--freeform-zoom')) {
    return;
  }

  const anchorPoint = anchor ?? getViewportCenter();
  const contentX = (viewportEl.scrollLeft + anchorPoint.x) / prevZoom;
  const contentY = (viewportEl.scrollTop + anchorPoint.y) / prevZoom;

  currentZoom = clamped;
  viewportEl.style.setProperty('--freeform-zoom', String(currentZoom));

  viewportEl.scrollLeft = contentX * currentZoom - anchorPoint.x;
  viewportEl.scrollTop = contentY * currentZoom - anchorPoint.y;

  zoomHook?.onZoom?.(currentZoom);
}

function clamp(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, round(value)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function getViewportCenter(): { x: number; y: number } {
  if (!viewportEl) return { x: 0, y: 0 };
  return { x: viewportEl.clientWidth / 2, y: viewportEl.clientHeight / 2 };
}
