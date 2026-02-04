import { sendMoveCard, sendCommitFreeformOrder } from './messageHandler';

let isDragging = false;
let dragTarget: HTMLElement | null = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let highestZ = 100;

const SNAP_THRESHOLD = 8;
const SMOOTHING = 0.25;
const SNAP_EPSILON = 0.5;

// パフォーマンス最適化用キャッシュ
let cachedContainerRect: DOMRect | null = null;
let cachedScrollLeft = 0;
let cachedScrollTop = 0;
let startLeft = 0;
let startTop = 0;
let rawX = 0;
let rawY = 0;
let targetX = 0;
let targetY = 0;
let currentX = 0;
let currentY = 0;
let dragWidth = 0;
let dragHeight = 0;
let snapTargetsX: number[] = [];
let snapTargetsY: number[] = [];
let rafId = 0;
let dragContainer: HTMLElement | null = null;
let scrollHandler: (() => void) | null = null;

/** フリーフォームモードを初期化 */
export function initFreeformMode(container: HTMLElement): void {
  container.classList.remove('grid-mode');
  container.classList.add('freeform-mode');

  // カードに初期位置を設定（位置がない場合はグリッド風に配置）
  const cards = container.querySelectorAll<HTMLElement>('.card');
  const cardWidth = 220;
  const minHeightValue = parseFloat(getComputedStyle(container).getPropertyValue('--card-min-height-freeform'));
  const cardHeight = Number.isFinite(minHeightValue) && minHeightValue > 0 ? minHeightValue : 150;
  const gap = 16;
  const cols = 4;

  cards.forEach((card, index) => {
    card.style.position = 'absolute';

    // data属性から位置を取得、なければ自動配置
    const posX = card.dataset.posX;
    const posY = card.dataset.posY;

    if (posX && posY) {
      card.style.left = `${posX}px`;
      card.style.top = `${posY}px`;
    } else {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = col * (cardWidth + gap) + gap;
      const y = row * (cardHeight + gap) + gap;
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      card.dataset.posX = String(x);
      card.dataset.posY = String(y);
    }

    card.style.zIndex = String(100 + index);
  });

  highestZ = 100 + cards.length;

  // mousedownイベント（カードヘッダーのみ）
  container.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function onMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  // カードヘッダーからドラッグ開始
  const header = target.closest('.card-header');
  if (!header) return;

  const card = header.closest<HTMLElement>('.card');
  if (!card) return;

  const container = card.parentElement;
  if (!container) return;

  e.preventDefault();
  isDragging = true;
  dragTarget = card;
  dragContainer = container;

  // containerRectをキャッシュ（mousemoveで毎回計算しない）
  cachedContainerRect = container.getBoundingClientRect();
  cachedScrollLeft = container.scrollLeft;
  cachedScrollTop = container.scrollTop;

  // 開始位置を記録
  startLeft = parseFloat(card.style.left || '0');
  startTop = parseFloat(card.style.top || '0');
  rawX = startLeft;
  rawY = startTop;
  targetX = startLeft;
  targetY = startTop;
  currentX = startLeft;
  currentY = startTop;

  const rect = card.getBoundingClientRect();
  dragWidth = rect.width;
  dragHeight = rect.height;
  dragOffsetX = e.clientX - rect.left;
  dragOffsetY = e.clientY - rect.top;

  const snapTargets = collectSnapTargets(container, card);
  snapTargetsX = snapTargets.x;
  snapTargetsY = snapTargets.y;

  // 最前面に持ってくる
  highestZ++;
  card.style.zIndex = String(highestZ);
  card.classList.add('card-dragging');

  // ドラッグ中のスクロール対応
  scrollHandler = () => {
    cachedScrollLeft = container.scrollLeft;
    cachedScrollTop = container.scrollTop;
  };
  container.addEventListener('scroll', scrollHandler);
}

function onMouseMove(e: MouseEvent): void {
  if (!isDragging || !dragTarget || !cachedContainerRect) return;

  const x = e.clientX - cachedContainerRect.left - dragOffsetX + cachedScrollLeft;
  const y = e.clientY - cachedContainerRect.top - dragOffsetY + cachedScrollTop;

  rawX = Math.max(0, x);
  rawY = Math.max(0, y);

  if (e.altKey) {
    targetX = rawX;
    targetY = rawY;
  } else {
    const snapped = getSnappedPosition(rawX, rawY);
    targetX = snapped.x;
    targetY = snapped.y;
  }

  ensureTick();
}

function onMouseUp(_e: MouseEvent): void {
  if (!isDragging || !dragTarget) return;

  // 保留中のrAFをキャンセル
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // transformをクリアし、最終位置をleft/topに確定
  dragTarget.style.transform = '';
  dragTarget.style.left = `${targetX}px`;
  dragTarget.style.top = `${targetY}px`;
  dragTarget.dataset.posX = String(targetX);
  dragTarget.dataset.posY = String(targetY);

  dragTarget.classList.remove('card-dragging');

  // 位置をExtensionに送信
  const cardId = dragTarget.dataset.id;
  if (cardId) {
    sendMoveCard(cardId, targetX, targetY);
  }

  // スクロールリスナーを除去
  if (dragContainer && scrollHandler) {
    dragContainer.removeEventListener('scroll', scrollHandler);
  }

  isDragging = false;
  dragTarget = null;
  dragContainer = null;
  cachedContainerRect = null;
  snapTargetsX = [];
  snapTargetsY = [];
  scrollHandler = null;
}

/** フリーフォームモードを破棄 */
export function destroyFreeformMode(container: HTMLElement): void {
  container.removeEventListener('mousedown', onMouseDown);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);

  // ドラッグ中に破棄された場合のクリーンアップ
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (dragContainer && scrollHandler) {
    dragContainer.removeEventListener('scroll', scrollHandler);
  }
  isDragging = false;
  dragTarget = null;
  dragContainer = null;
  cachedContainerRect = null;
  snapTargetsX = [];
  snapTargetsY = [];
  scrollHandler = null;
}

function collectSnapTargets(container: HTMLElement, exclude: HTMLElement): { x: number[]; y: number[] } {
  const xTargets: number[] = [];
  const yTargets: number[] = [];
  const cards = container.querySelectorAll<HTMLElement>('.card');
  cards.forEach(card => {
    if (card === exclude) return;
    const { x, y } = getCardPosition(card);
    const width = card.offsetWidth || parseFloat(card.style.width || '0') || 0;
    const height = card.offsetHeight || parseFloat(card.style.height || '0') || 0;
    xTargets.push(x, x + width);
    yTargets.push(y, y + height);
  });
  return { x: xTargets, y: yTargets };
}

function getCardPosition(card: HTMLElement): { x: number; y: number } {
  const posX = card.dataset.posX ?? card.style.left;
  const posY = card.dataset.posY ?? card.style.top;
  const x = parseFloat(posX || '0');
  const y = parseFloat(posY || '0');
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

function getSnappedPosition(x: number, y: number): { x: number; y: number } {
  const snappedX = snapAxis(x, dragWidth, snapTargetsX);
  const snappedY = snapAxis(y, dragHeight, snapTargetsY);
  return {
    x: Math.max(0, snappedX),
    y: Math.max(0, snappedY),
  };
}

function snapAxis(rawPos: number, size: number, targets: number[]): number {
  if (targets.length === 0 || size === 0) return rawPos;
  let bestPos = rawPos;
  let bestDist = SNAP_THRESHOLD + 1;

  for (const target of targets) {
    const leftDist = Math.abs(rawPos - target);
    if (leftDist <= SNAP_THRESHOLD && leftDist < bestDist) {
      bestDist = leftDist;
      bestPos = target;
    }
    const rightDist = Math.abs(rawPos + size - target);
    if (rightDist <= SNAP_THRESHOLD && rightDist < bestDist) {
      bestDist = rightDist;
      bestPos = target - size;
    }
  }

  return bestPos;
}

function ensureTick(): void {
  if (rafId) return;
  rafId = requestAnimationFrame(tick);
}

function tick(): void {
  rafId = 0;
  if (!isDragging || !dragTarget) return;

  currentX += (targetX - currentX) * SMOOTHING;
  currentY += (targetY - currentY) * SMOOTHING;

  if (Math.abs(targetX - currentX) < SNAP_EPSILON) currentX = targetX;
  if (Math.abs(targetY - currentY) < SNAP_EPSILON) currentY = targetY;

  const dx = currentX - startLeft;
  const dy = currentY - startTop;
  dragTarget.style.transform = `translate(${dx}px, ${dy}px)`;

  if (Math.abs(targetX - currentX) > 0.1 || Math.abs(targetY - currentY) > 0.1) {
    rafId = requestAnimationFrame(tick);
  }
}

/** 現在の配置から左上→右下の順序でカードIDを返す */
export function commitFreeformOrder(container: HTMLElement): void {
  const cards = Array.from(container.querySelectorAll<HTMLElement>('.card'));
  // Y座標でグループ分け（近い位置は同じ行とみなす）
  const rowThreshold = 80;
  cards.sort((a, b) => {
    const ay = parseFloat(a.dataset.posY || '0');
    const by = parseFloat(b.dataset.posY || '0');
    if (Math.abs(ay - by) < rowThreshold) {
      // 同じ行なら左から右
      const ax = parseFloat(a.dataset.posX || '0');
      const bx = parseFloat(b.dataset.posX || '0');
      return ax - bx;
    }
    return ay - by;
  });

  const cardIds = cards.map(c => c.dataset.id).filter((id): id is string => !!id);
  sendCommitFreeformOrder(cardIds);
}
