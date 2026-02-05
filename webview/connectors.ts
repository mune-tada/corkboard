import { LabelDefinition, LinkAnchor, LinkData } from './types';
import { getFreeformZoom } from './freeformZoom';

type LinkHooks = {
  getLinks: () => LinkData[];
  getLabelColors: () => LabelDefinition[];
  onAddLink: (link: LinkData) => void;
  onUpdateLink: (linkId: string, changes: Partial<LinkData>) => void;
  onRemoveLink: (linkId: string) => void;
};

type LinkElements = {
  path: SVGPathElement;
  labelFo: SVGForeignObjectElement;
  labelDiv: HTMLDivElement;
};

const LINK_LABEL_PLACEHOLDER = 'コメントなし';
const RECONNECT_HIT_RADIUS = 14;

let hooks: LinkHooks | null = null;
let containerEl: HTMLElement | null = null;
let viewportEl: HTMLElement | null = null;
let svgEl: SVGSVGElement | null = null;
let linkGroup: SVGGElement | null = null;
let tempPath: SVGPathElement | null = null;
let currentLinks: LinkData[] = [];
let linkElementMap: Map<string, LinkElements> = new Map();

let connectMode = false;
let isConnecting = false;
let connectFromId: string | null = null;
let connectFromAnchor: LinkAnchor | null = null;
let isReconnecting = false;
let reconnectLinkId: string | null = null;
let reconnectSide: 'from' | 'to' | null = null;
let reconnectFixedId: string | null = null;
let reconnectFixedAnchor: LinkAnchor | null = null;
let reconnectColor: string | null = null;
let selectedLinkId: string | null = null;
let editingLinkId: string | null = null;
let attachDone = false;
let linkContextMenu: HTMLElement | null = null;

export function initConnectorLayer(viewport: HTMLElement, content: HTMLElement, linkHooks: LinkHooks): void {
  viewportEl = viewport;
  containerEl = content;
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
    cancelReconnecting();
    closeLinkContextMenu();
  }
}

export function setConnectMode(isOn: boolean): void {
  connectMode = isOn;
  if (viewportEl) {
    viewportEl.classList.toggle('connect-mode', isOn);
  }
  if (!isOn) {
    cancelConnecting();
    cancelReconnecting();
  }
}

export function renderLinks(links: LinkData[]): void {
  if (!linkGroup) return;
  closeLinkContextMenu();
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
    applyLinkColorStyles(path, labelDiv, link.color ?? null);
    const displayLabel = normalizeLinkLabel(link.label);
    labelDiv.textContent = displayLabel;
    if (!displayLabel) {
      labelFo.style.display = 'none';
    }
    labelFo.appendChild(labelDiv);

    path.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelectedLink(link.id);
    });
    path.addEventListener('mousedown', (e) => {
      if (maybeStartReconnectFromPath(link.id, e)) return;
    });
    path.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startLabelEdit(link.id, true);
    });
    path.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedLink(link.id);
      openLinkContextMenu(link.id, e.clientX, e.clientY);
    });
    labelDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelectedLink(link.id);
    });
    labelDiv.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startLabelEdit(link.id, true);
    });
    labelDiv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedLink(link.id);
      openLinkContextMenu(link.id, e.clientX, e.clientY);
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
  const zoom = getFreeformZoom();

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

    const fromBox = rectToBox(fromRect, containerRect, zoom);
    const toBox = rectToBox(toRect, containerRect, zoom);
    const autoAnchors = pickAnchors(fromBox, toBox);
    const from = link.fromAnchor ? getAnchorPoint(fromBox, link.fromAnchor) : autoAnchors.from;
    const to = link.toAnchor ? getAnchorPoint(toBox, link.toAnchor) : autoAnchors.to;

    const d = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    elements.path.setAttribute('d', d);

    const isEditing = editingLinkId === link.id && elements.labelDiv.querySelector('input');
    const displayLabel = normalizeLinkLabel(link.label);
    const liveText = isEditing
      ? (elements.labelDiv.querySelector('input') as HTMLInputElement | null)?.value || ''
      : displayLabel;
    if (!isEditing && !displayLabel) {
      elements.labelFo.style.display = 'none';
      elements.labelFo.setAttribute('width', '0');
      elements.labelFo.setAttribute('height', '0');
      elements.labelDiv.textContent = '';
      continue;
    }
    elements.labelFo.style.display = '';
    const size = measureLabel(liveText);
    const midpoint = getLabelPoint(from, to);
    elements.labelFo.setAttribute('x', String(midpoint.x - size.width / 2));
    elements.labelFo.setAttribute('y', String(midpoint.y - size.height / 2));
    elements.labelFo.setAttribute('width', String(size.width));
    elements.labelFo.setAttribute('height', String(size.height));
    if (!isEditing) {
      elements.labelDiv.textContent = displayLabel;
    }
  }
}

export function updateLinkColor(linkId: string, color: string | null): void {
  const elements = linkElementMap.get(linkId);
  if (!elements) return;
  applyLinkColorStyles(elements.path, elements.labelDiv, color);
}

function maybeStartReconnectFromPath(linkId: string, e: MouseEvent): boolean {
  if (!containerEl) return false;
  if (e.button !== 0) return false;
  if (editingLinkId) return false;
  const link = currentLinks.find(l => l.id === linkId);
  if (!link) return false;
  const endpoints = getLinkEndpoints(link);
  if (!endpoints) return false;

  const point = clientToContentPoint(e.clientX, e.clientY);
  const x = point.x;
  const y = point.y;
  const distFrom = Math.hypot(x - endpoints.from.x, y - endpoints.from.y);
  const distTo = Math.hypot(x - endpoints.to.x, y - endpoints.to.y);

  if (distFrom > RECONNECT_HIT_RADIUS && distTo > RECONNECT_HIT_RADIUS) return false;
  const side: 'from' | 'to' = distFrom <= distTo ? 'from' : 'to';

  e.preventDefault();
  e.stopPropagation();
  setSelectedLink(linkId);
  startReconnect(linkId, side, e.clientX, e.clientY);
  return true;
}

function getLinkEndpoints(link: LinkData): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
  if (!containerEl) return null;
  const fromCard = containerEl.querySelector<HTMLElement>(`.card[data-id="${link.fromId}"]`);
  const toCard = containerEl.querySelector<HTMLElement>(`.card[data-id="${link.toId}"]`);
  if (!fromCard || !toCard) return null;

  const containerRect = containerEl.getBoundingClientRect();
  const zoom = getFreeformZoom();
  const fromRect = fromCard.getBoundingClientRect();
  const toRect = toCard.getBoundingClientRect();
  const fromBox = rectToBox(fromRect, containerRect, zoom);
  const toBox = rectToBox(toRect, containerRect, zoom);
  const autoAnchors = pickAnchors(fromBox, toBox);
  const from = link.fromAnchor ? getAnchorPoint(fromBox, link.fromAnchor) : autoAnchors.from;
  const to = link.toAnchor ? getAnchorPoint(toBox, link.toAnchor) : autoAnchors.to;
  return { from, to };
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
  const anchor = getHandleAnchor(handle);
  if (!anchor) return;

  e.preventDefault();
  e.stopPropagation();
  closeLinkContextMenu();
  cancelReconnecting();

  connectFromId = card.dataset.id;
  connectFromAnchor = anchor;
  isConnecting = true;
  ensureTempPath();

  updateTempPath(e.clientX, e.clientY);
  document.addEventListener('mousemove', onConnectMouseMove);
  document.addEventListener('mouseup', onConnectMouseUp);
}

function onConnectMouseMove(e: MouseEvent): void {
  if (!isConnecting) return;
  updateTempPath(e.clientX, e.clientY);
  updateHandleHighlight(e.clientX, e.clientY);
}

function onConnectMouseUp(e: MouseEvent): void {
  if (!isConnecting) return;
  document.removeEventListener('mousemove', onConnectMouseMove);
  document.removeEventListener('mouseup', onConnectMouseUp);

  const handleHit = getHandleFromPoint(e.clientX, e.clientY);
  const targetId = handleHit?.card.dataset.id || null;
  const targetAnchor = handleHit?.anchor ?? null;
  const fromId = connectFromId;
  const fromAnchor = connectFromAnchor;

  cancelConnecting();

  if (fromId && targetId && fromAnchor && targetAnchor && fromId !== targetId && hooks) {
    const link: LinkData = {
      id: generateId(),
      fromId,
      toId: targetId,
      label: '',
      fromAnchor,
      toAnchor: targetAnchor,
    };
    hooks.onAddLink(link);
    requestAnimationFrame(() => {
      setSelectedLink(link.id);
      startLabelEdit(link.id, true);
    });
  }
}

function updateTempPath(clientX: number, clientY: number): void {
  if (!containerEl || !tempPath) return;
  const containerRect = containerEl.getBoundingClientRect();
  const zoom = getFreeformZoom();
  const toPoint = clientToContentPoint(clientX, clientY);
  const pointBox = {
    left: toPoint.x,
    right: toPoint.x,
    top: toPoint.y,
    bottom: toPoint.y,
    cx: toPoint.x,
    cy: toPoint.y,
  };

  let fromPoint: { x: number; y: number } | null = null;

  if (isReconnecting && reconnectFixedId) {
    const fixedCard = containerEl.querySelector<HTMLElement>(`.card[data-id="${reconnectFixedId}"]`);
    if (!fixedCard) return;
    const fixedRect = fixedCard.getBoundingClientRect();
    const fixedBox = rectToBox(fixedRect, containerRect, zoom);
    if (reconnectFixedAnchor) {
      fromPoint = getAnchorPoint(fixedBox, reconnectFixedAnchor);
    } else {
      const { from } = pickAnchors(fixedBox, pointBox);
      fromPoint = from;
    }
    if (reconnectColor) {
      tempPath.style.setProperty('--link-color', reconnectColor);
    } else {
      tempPath.style.removeProperty('--link-color');
    }
  } else if (connectFromId) {
    const fromCard = containerEl.querySelector<HTMLElement>(`.card[data-id="${connectFromId}"]`);
    if (!fromCard) return;
    const fromRect = fromCard.getBoundingClientRect();
    const fromBox = rectToBox(fromRect, containerRect, zoom);
    if (connectFromAnchor) {
      fromPoint = getAnchorPoint(fromBox, connectFromAnchor);
    } else {
      const { from } = pickAnchors(fromBox, pointBox);
      fromPoint = from;
    }
    tempPath.style.removeProperty('--link-color');
  }

  if (!fromPoint) return;
  tempPath.setAttribute('d', `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`);
  tempPath.setAttribute('marker-end', 'url(#connector-arrow)');
}

function updateHandleHighlight(clientX: number, clientY: number): void {
  if (!containerEl) return;
  clearHandleHighlight();
  const hit = getHandleFromPoint(clientX, clientY);
  if (!hit) return;
  if (isConnecting && connectFromId && hit.card.dataset.id === connectFromId) return;
  if (isReconnecting && reconnectFixedId && hit.card.dataset.id === reconnectFixedId) return;
  hit.handle.classList.add('card-connect-handle-target');
}

function clearHandleHighlight(): void {
  if (!containerEl) return;
  containerEl.querySelectorAll('.card-connect-handle-target').forEach(el => el.classList.remove('card-connect-handle-target'));
}

function getHandleFromPoint(clientX: number, clientY: number): { handle: HTMLElement; card: HTMLElement; anchor: LinkAnchor } | null {
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  if (!el) return null;
  const handle = el.closest<HTMLElement>('.card-connect-handle');
  if (!handle) return null;
  const card = handle.closest<HTMLElement>('.card');
  if (!card || !card.dataset.id) return null;
  const anchor = getHandleAnchor(handle);
  if (!anchor) return null;
  return { handle, card, anchor };
}

function cancelConnecting(): void {
  isConnecting = false;
  connectFromId = null;
  connectFromAnchor = null;
  if (tempPath) {
    tempPath.setAttribute('d', '');
  }
  if (containerEl) {
    containerEl.querySelectorAll('.card-connect-target').forEach(el => el.classList.remove('card-connect-target'));
  }
  clearHandleHighlight();
}

function ensureTempPath(): void {
  if (!svgEl) return;
  if (!tempPath) {
    tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.classList.add('link-temp');
    svgEl.appendChild(tempPath);
  }
}

function setReconnectMode(isOn: boolean): void {
  if (viewportEl) {
    viewportEl.classList.toggle('reconnect-mode', isOn);
  }
}

function startReconnect(linkId: string, side: 'from' | 'to', clientX: number, clientY: number): void {
  if (!hooks || !containerEl) return;
  const link = currentLinks.find(l => l.id === linkId);
  if (!link) return;
  cancelConnecting();
  cancelReconnecting();
  isReconnecting = true;
  reconnectLinkId = linkId;
  reconnectSide = side;
  if (side === 'from') {
    reconnectFixedId = link.toId;
    reconnectFixedAnchor = link.toAnchor ?? null;
  } else {
    reconnectFixedId = link.fromId;
    reconnectFixedAnchor = link.fromAnchor ?? null;
  }
  reconnectColor = link.color ?? null;
  setReconnectMode(true);
  ensureTempPath();
  updateTempPath(clientX, clientY);
  updateHandleHighlight(clientX, clientY);
  document.addEventListener('mousemove', onReconnectMouseMove);
  document.addEventListener('mouseup', onReconnectMouseUp);
}

function onReconnectMouseMove(e: MouseEvent): void {
  if (!isReconnecting) return;
  updateTempPath(e.clientX, e.clientY);
  updateHandleHighlight(e.clientX, e.clientY);
}

function onReconnectMouseUp(e: MouseEvent): void {
  if (!isReconnecting) return;
  document.removeEventListener('mousemove', onReconnectMouseMove);
  document.removeEventListener('mouseup', onReconnectMouseUp);

  const hit = getHandleFromPoint(e.clientX, e.clientY);
  const targetId = hit?.card.dataset.id || null;
  const targetAnchor = hit?.anchor ?? null;
  const linkId = reconnectLinkId;
  const side = reconnectSide;
  const fixedId = reconnectFixedId;

  cancelReconnecting();

  if (!hooks || !linkId || !side || !targetId || !targetAnchor) return;
  if (fixedId && targetId === fixedId) return;

  const changes: Partial<LinkData> = side === 'from'
    ? { fromId: targetId, fromAnchor: targetAnchor }
    : { toId: targetId, toAnchor: targetAnchor };

  hooks.onUpdateLink(linkId, changes);
  requestAnimationFrame(() => setSelectedLink(linkId));
}

function cancelReconnecting(): void {
  if (isReconnecting) {
    document.removeEventListener('mousemove', onReconnectMouseMove);
    document.removeEventListener('mouseup', onReconnectMouseUp);
  }
  isReconnecting = false;
  reconnectLinkId = null;
  reconnectSide = null;
  reconnectFixedId = null;
  reconnectFixedAnchor = null;
  reconnectColor = null;
  if (tempPath) {
    tempPath.setAttribute('d', '');
    tempPath.style.removeProperty('--link-color');
  }
  clearHandleHighlight();
  setReconnectMode(false);
}

function openLinkContextMenu(linkId: string, clientX: number, clientY: number): void {
  if (!hooks) return;
  closeLinkContextMenu();

  const menu = document.createElement('div');
  menu.className = 'card-context-menu link-context-menu';

  const addMenuItem = (label: string, action: () => void): void => {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.textContent = label;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      closeLinkContextMenu();
      action();
    });
    menu.appendChild(item);
  };

  const addMenuItemWithEvent = (label: string, action: (event: MouseEvent) => void): void => {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.textContent = label;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      closeLinkContextMenu();
      action(e as MouseEvent);
    });
    menu.appendChild(item);
  };

  addMenuItem('✏️ コメントを編集', () => startLabelEdit(linkId, true));

  const colors = hooks.getLabelColors();
  const noneItem = document.createElement('div');
  noneItem.className = 'menu-item';
  noneItem.textContent = '🎨 色: （なし）';
  noneItem.addEventListener('click', (e) => {
    e.stopPropagation();
    closeLinkContextMenu();
    hooks?.onUpdateLink(linkId, { color: null });
  });
  menu.appendChild(noneItem);

  colors.forEach((colorDef) => {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.innerHTML = `<span class="label-swatch" style="background:${colorDef.color}"></span> 🎨 色: ${colorDef.name}`;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      closeLinkContextMenu();
      hooks?.onUpdateLink(linkId, { color: colorDef.color });
    });
    menu.appendChild(item);
  });

  addMenuItemWithEvent('🔗 始点を外して再接続', (e) => startReconnect(linkId, 'from', e.clientX, e.clientY));
  addMenuItemWithEvent('🔗 終点を外して再接続', (e) => startReconnect(linkId, 'to', e.clientX, e.clientY));
  addMenuItem('🗑️ 削除', () => hooks?.onRemoveLink(linkId));

  positionContextMenu(menu, clientX, clientY);
  linkContextMenu = menu;

  const closeMenu = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      closeLinkContextMenu();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

function closeLinkContextMenu(): void {
  if (linkContextMenu) {
    linkContextMenu.remove();
    linkContextMenu = null;
  }
}

function positionContextMenu(menu: HTMLElement, clientX: number, clientY: number): void {
  const margin = 8;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  menu.style.position = 'fixed';
  menu.style.visibility = 'hidden';
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  let left = clientX;
  let top = clientY;

  if (left + rect.width > viewportWidth - margin) {
    left = viewportWidth - rect.width - margin;
  }
  if (top + rect.height > viewportHeight - margin) {
    top = viewportHeight - rect.height - margin;
  }

  left = Math.min(Math.max(left, margin), Math.max(margin, viewportWidth - rect.width - margin));
  top = Math.min(Math.max(top, margin), Math.max(margin, viewportHeight - rect.height - margin));

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = 'visible';
}

function onContainerClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (target.closest('.link-context-menu')) return;
  if (target.closest('.link-label') || target.closest('.link-path') || target.closest('.card-connect-handle')) return;
  clearLinkSelection();
}

function onDocumentClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (target.closest('.link-context-menu')) return;
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
  elements.labelFo.style.display = '';
  const currentText = normalizeLinkLabel(elements.labelDiv.textContent || '');
  const input = document.createElement('input');
  input.className = 'link-label-input';
  input.type = 'text';
  input.value = currentText;
  elements.labelDiv.innerHTML = '';
  elements.labelDiv.appendChild(input);
  input.focus();
  if (selectAll) {
    input.select();
  }
  input.addEventListener('input', () => updateLinkPositions());
  requestAnimationFrame(() => updateLinkPositions());

  const commit = () => {
    if (editingLinkId !== linkId) return;
    const nextValue = input.value.trim();
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

function applyLinkColorStyles(path: SVGPathElement, labelDiv: HTMLDivElement, color: string | null): void {
  if (color) {
    path.style.setProperty('--link-color', color);
    labelDiv.style.setProperty('--link-color', color);
  } else {
    path.style.removeProperty('--link-color');
    labelDiv.style.removeProperty('--link-color');
  }
}

function getHandleAnchor(handle: HTMLElement): LinkAnchor | null {
  const raw = handle.dataset.handle;
  if (raw === 'top' || raw === 'right' || raw === 'bottom' || raw === 'left') {
    return raw;
  }
  return null;
}

function rectToBox(
  rect: DOMRect,
  containerRect: DOMRect,
  zoom: number
): { left: number; right: number; top: number; bottom: number; cx: number; cy: number } {
  const left = (rect.left - containerRect.left) / zoom;
  const top = (rect.top - containerRect.top) / zoom;
  const width = rect.width / zoom;
  const height = rect.height / zoom;
  const right = left + width;
  const bottom = top + height;
  const cx = left + width / 2;
  const cy = top + height / 2;
  return { left, right, top, bottom, cx, cy };
}

function getAnchorPoint(
  box: { left: number; right: number; top: number; bottom: number; cx: number; cy: number },
  anchor: LinkAnchor
): { x: number; y: number } {
  switch (anchor) {
    case 'top':
      return { x: box.cx, y: box.top };
    case 'right':
      return { x: box.right, y: box.cy };
    case 'bottom':
      return { x: box.cx, y: box.bottom };
    case 'left':
      return { x: box.left, y: box.cy };
  }
  return { x: box.cx, y: box.cy };
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

function normalizeLinkLabel(label: string | null | undefined): string {
  if (!label) return '';
  const trimmed = label.trim();
  if (!trimmed || trimmed === LINK_LABEL_PLACEHOLDER) return '';
  return trimmed;
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

function clientToContentPoint(clientX: number, clientY: number): { x: number; y: number } {
  if (!containerEl) return { x: 0, y: 0 };
  const rect = containerEl.getBoundingClientRect();
  const zoom = getFreeformZoom();
  return {
    x: (clientX - rect.left) / zoom,
    y: (clientY - rect.top) / zoom,
  };
}
