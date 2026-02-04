import { LinkData } from './types';

type LinkHooks = {
  getLinks: () => LinkData[];
  onAddLink: (link: LinkData) => void;
  onUpdateLink: (linkId: string, changes: Partial<LinkData>) => void;
  onRemoveLink: (linkId: string) => void;
};

type LinkElements = {
  path: SVGPathElement;
  labelFo: SVGForeignObjectElement;
  labelDiv: HTMLDivElement;
};

let hooks: LinkHooks | null = null;
let containerEl: HTMLElement | null = null;
let svgEl: SVGSVGElement | null = null;
let linkGroup: SVGGElement | null = null;
let tempPath: SVGPathElement | null = null;
let currentLinks: LinkData[] = [];
let linkElementMap: Map<string, LinkElements> = new Map();

let connectMode = false;
let isConnecting = false;
let connectFromId: string | null = null;
let selectedLinkId: string | null = null;
let editingLinkId: string | null = null;
let attachDone = false;

export function initConnectorLayer(container: HTMLElement, linkHooks: LinkHooks): void {
  containerEl = container;
  hooks = linkHooks;
  ensureSvgLayer();
  attachContainerListeners();
  if (!attachDone) {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeyDown);
    window.addEventListener('resize', updateSvgSize);
    attachDone = true;
  }
  updateSvgSize();
}

export function setConnectorVisible(visible: boolean): void {
  if (!svgEl) return;
  svgEl.classList.toggle('hidden', !visible);
  if (!visible) {
    clearLinkSelection();
    cancelConnecting();
  }
}

export function setConnectMode(isOn: boolean): void {
  connectMode = isOn;
  if (containerEl) {
    containerEl.classList.toggle('connect-mode', isOn);
  }
  if (!isOn) {
    cancelConnecting();
  }
}

export function renderLinks(links: LinkData[]): void {
  if (!linkGroup) return;
  currentLinks = links;
  const prevSelected = selectedLinkId;
  updateSvgSize();
  linkGroup.innerHTML = '';
  linkElementMap.clear();

  for (const link of links) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('link-path');
    path.dataset.linkId = link.id;
    path.setAttribute('marker-end', 'url(#connector-arrow)');

    const labelFo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    labelFo.classList.add('link-label-fo');
    labelFo.dataset.linkId = link.id;
    labelFo.setAttribute('width', '120');
    labelFo.setAttribute('height', '26');

    const labelDiv = document.createElement('div');
    labelDiv.className = 'link-label';
    labelDiv.dataset.linkId = link.id;
    labelDiv.textContent = link.label || 'コメントなし';
    labelFo.appendChild(labelDiv);

    path.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelectedLink(link.id);
    });
    labelDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelectedLink(link.id);
    });
    labelDiv.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startLabelEdit(link.id, true);
    });

    linkGroup.appendChild(path);
    linkGroup.appendChild(labelFo);
    linkElementMap.set(link.id, { path, labelFo, labelDiv });
  }

  updateLinkPositions();
  if (prevSelected && linkElementMap.has(prevSelected)) {
    setSelectedLink(prevSelected);
  } else {
    selectedLinkId = null;
  }
}

export function updateLinkPositions(): void {
  if (!containerEl || !linkGroup) return;
  updateSvgSize();
  const containerRect = containerEl.getBoundingClientRect();
  const scrollLeft = containerEl.scrollLeft;
  const scrollTop = containerEl.scrollTop;

  for (const link of currentLinks) {
    const elements = linkElementMap.get(link.id);
    if (!elements) continue;
    const fromCard = containerEl.querySelector<HTMLElement>(`.card[data-id="${link.fromId}"]`);
    const toCard = containerEl.querySelector<HTMLElement>(`.card[data-id="${link.toId}"]`);
    if (!fromCard || !toCard) {
      elements.path.setAttribute('d', '');
      elements.labelFo.setAttribute('width', '0');
      elements.labelFo.setAttribute('height', '0');
      continue;
    }

    const fromRect = fromCard.getBoundingClientRect();
    const toRect = toCard.getBoundingClientRect();

    const fromBox = rectToBox(fromRect, containerRect, scrollLeft, scrollTop);
    const toBox = rectToBox(toRect, containerRect, scrollLeft, scrollTop);
    const { from, to } = pickAnchors(fromBox, toBox);

    const d = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    elements.path.setAttribute('d', d);

    const isEditing = editingLinkId === link.id && elements.labelDiv.querySelector('input');
    const liveText = isEditing
      ? (elements.labelDiv.querySelector('input') as HTMLInputElement | null)?.value || ''
      : link.label || 'コメントなし';
    const labelText = liveText || (isEditing ? '' : 'コメントなし');
    const size = measureLabel(labelText || 'コメントなし');
    const midpoint = getLabelPoint(from, to);
    elements.labelFo.setAttribute('x', String(midpoint.x - size.width / 2));
    elements.labelFo.setAttribute('y', String(midpoint.y - size.height / 2));
    elements.labelFo.setAttribute('width', String(size.width));
    elements.labelFo.setAttribute('height', String(size.height));
    if (!isEditing) {
      elements.labelDiv.textContent = labelText || 'コメントなし';
    }
  }
}

export function clearLinkSelection(): void {
  setSelectedLink(null);
}

export function isEditingLinkLabel(): boolean {
  return editingLinkId !== null;
}

function ensureSvgLayer(): void {
  if (!containerEl) return;
  if (svgEl && svgEl.parentElement === containerEl) return;

  svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.classList.add('connector-layer');
  svgEl.setAttribute('aria-hidden', 'true');
  tempPath = null;

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'connector-arrow');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '10');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '8');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  arrowPath.setAttribute('fill', 'currentColor');
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svgEl.appendChild(defs);

  linkGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svgEl.appendChild(linkGroup);

  containerEl.appendChild(svgEl);
}

function attachContainerListeners(): void {
  if (!containerEl) return;
  if (containerEl.dataset.connectorsAttached === 'true') return;
  containerEl.dataset.connectorsAttached = 'true';
  containerEl.addEventListener('mousedown', onContainerMouseDown);
  containerEl.addEventListener('click', onContainerClick);
}

function onContainerMouseDown(e: MouseEvent): void {
  if (!connectMode || !containerEl) return;
  const target = e.target as HTMLElement;
  const handle = target.closest('.card-connect-handle');
  if (!handle) return;
  const card = handle.closest<HTMLElement>('.card');
  if (!card || !card.dataset.id) return;

  e.preventDefault();
  e.stopPropagation();

  connectFromId = card.dataset.id;
  isConnecting = true;
  ensureTempPath();

  updateTempPath(e.clientX, e.clientY);
  document.addEventListener('mousemove', onConnectMouseMove);
  document.addEventListener('mouseup', onConnectMouseUp);
}

function onConnectMouseMove(e: MouseEvent): void {
  if (!isConnecting) return;
  updateTempPath(e.clientX, e.clientY);
  updateTargetHighlight(e.clientX, e.clientY);
}

function onConnectMouseUp(e: MouseEvent): void {
  if (!isConnecting) return;
  document.removeEventListener('mousemove', onConnectMouseMove);
  document.removeEventListener('mouseup', onConnectMouseUp);

  const targetCard = getCardFromPoint(e.clientX, e.clientY);
  const targetId = targetCard?.dataset.id || null;
  const fromId = connectFromId;

  cancelConnecting();

  if (fromId && targetId && fromId !== targetId && hooks) {
    const link: LinkData = {
      id: generateId(),
      fromId,
      toId: targetId,
      label: 'コメントなし',
    };
    hooks.onAddLink(link);
    requestAnimationFrame(() => {
      setSelectedLink(link.id);
      startLabelEdit(link.id, true);
    });
  }
}

function updateTempPath(clientX: number, clientY: number): void {
  if (!containerEl || !tempPath || !connectFromId) return;
  const fromCard = containerEl.querySelector<HTMLElement>(`.card[data-id="${connectFromId}"]`);
  if (!fromCard) return;
  const containerRect = containerEl.getBoundingClientRect();
  const scrollLeft = containerEl.scrollLeft;
  const scrollTop = containerEl.scrollTop;
  const fromRect = fromCard.getBoundingClientRect();
  const fromBox = rectToBox(fromRect, containerRect, scrollLeft, scrollTop);
  const toPoint = {
    x: clientX - containerRect.left + scrollLeft,
    y: clientY - containerRect.top + scrollTop,
  };
  const { from } = pickAnchors(fromBox, {
    left: toPoint.x,
    right: toPoint.x,
    top: toPoint.y,
    bottom: toPoint.y,
    cx: toPoint.x,
    cy: toPoint.y,
  });
  tempPath.setAttribute('d', `M ${from.x} ${from.y} L ${toPoint.x} ${toPoint.y}`);
  tempPath.setAttribute('marker-end', 'url(#connector-arrow)');
}

function updateTargetHighlight(clientX: number, clientY: number): void {
  if (!containerEl) return;
  containerEl.querySelectorAll('.card-connect-target').forEach(el => el.classList.remove('card-connect-target'));
  const card = getCardFromPoint(clientX, clientY);
  if (card && card.dataset.id !== connectFromId) {
    card.classList.add('card-connect-target');
  }
}

function getCardFromPoint(clientX: number, clientY: number): HTMLElement | null {
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  if (!el) return null;
  return el.closest<HTMLElement>('.card');
}

function cancelConnecting(): void {
  isConnecting = false;
  connectFromId = null;
  if (tempPath) {
    tempPath.setAttribute('d', '');
  }
  if (containerEl) {
    containerEl.querySelectorAll('.card-connect-target').forEach(el => el.classList.remove('card-connect-target'));
  }
}

function ensureTempPath(): void {
  if (!svgEl) return;
  if (!tempPath) {
    tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.classList.add('link-temp');
    svgEl.appendChild(tempPath);
  }
}

function onContainerClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (target.closest('.link-label') || target.closest('.link-path') || target.closest('.card-connect-handle')) return;
  clearLinkSelection();
}

function onDocumentClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (target.closest('.link-label') || target.closest('.link-path')) return;
  if (target.closest('.card-connect-handle')) return;
  clearLinkSelection();
}

function onDocumentKeyDown(e: KeyboardEvent): void {
  if (!selectedLinkId || !hooks) return;
  if (editingLinkId) return;
  const active = document.activeElement as HTMLElement | null;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;

  e.preventDefault();
  const linkId = selectedLinkId;
  clearLinkSelection();
  hooks.onRemoveLink(linkId);
}

function setSelectedLink(linkId: string | null): void {
  selectedLinkId = linkId;
  for (const [id, els] of linkElementMap) {
    const selected = id === linkId;
    els.path.classList.toggle('link-selected', selected);
    els.labelDiv.classList.toggle('link-selected', selected);
  }
}

function startLabelEdit(linkId: string, selectAll: boolean): void {
  if (!hooks) return;
  const elements = linkElementMap.get(linkId);
  if (!elements) return;
  if (editingLinkId) return;
  editingLinkId = linkId;
  const currentText = elements.labelDiv.textContent || '';
  const input = document.createElement('input');
  input.className = 'link-label-input';
  input.type = 'text';
  input.value = currentText === 'コメントなし' ? '' : currentText;
  elements.labelDiv.innerHTML = '';
  elements.labelDiv.appendChild(input);
  input.focus();
  if (selectAll) {
    input.select();
  }

  const commit = () => {
    if (editingLinkId !== linkId) return;
    const nextValue = input.value.trim() || 'コメントなし';
    editingLinkId = null;
    hooks.onUpdateLink(linkId, { label: nextValue });
  };

  const cancel = () => {
    if (editingLinkId !== linkId) return;
    editingLinkId = null;
    renderLinks(hooks.getLinks());
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });
}

function rectToBox(
  rect: DOMRect,
  containerRect: DOMRect,
  scrollLeft: number,
  scrollTop: number
): { left: number; right: number; top: number; bottom: number; cx: number; cy: number } {
  const left = rect.left - containerRect.left + scrollLeft;
  const top = rect.top - containerRect.top + scrollTop;
  const right = left + rect.width;
  const bottom = top + rect.height;
  const cx = left + rect.width / 2;
  const cy = top + rect.height / 2;
  return { left, right, top, bottom, cx, cy };
}

function pickAnchors(
  fromBox: { left: number; right: number; top: number; bottom: number; cx: number; cy: number },
  toBox: { left: number; right: number; top: number; bottom: number; cx: number; cy: number }
): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const dx = toBox.cx - fromBox.cx;
  const dy = toBox.cy - fromBox.cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) {
      return {
        from: { x: fromBox.right, y: fromBox.cy },
        to: { x: toBox.left, y: toBox.cy },
      };
    }
    return {
      from: { x: fromBox.left, y: fromBox.cy },
      to: { x: toBox.right, y: toBox.cy },
    };
  }
  if (dy >= 0) {
    return {
      from: { x: fromBox.cx, y: fromBox.bottom },
      to: { x: toBox.cx, y: toBox.top },
    };
  }
  return {
    from: { x: fromBox.cx, y: fromBox.top },
    to: { x: toBox.cx, y: toBox.bottom },
  };
}

function getLabelPoint(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ox = (-dy / len) * 12;
  const oy = (dx / len) * 12;
  return { x: mx + ox, y: my + oy };
}

function measureLabel(text: string): { width: number; height: number } {
  const base = text.length;
  const width = Math.min(220, Math.max(80, base * 7 + 36));
  return { width, height: 26 };
}

function generateId(): string {
  return `link_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function updateSvgSize(): void {
  if (!containerEl || !svgEl) return;
  const width = Math.max(containerEl.scrollWidth, containerEl.clientWidth);
  const height = Math.max(containerEl.scrollHeight, containerEl.clientHeight);
  svgEl.setAttribute('width', String(width));
  svgEl.setAttribute('height', String(height));
}
