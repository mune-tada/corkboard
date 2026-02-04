import { sendMoveCard, sendCommitFreeformOrder } from './messageHandler';

let isDragging = false;
let dragTarget: HTMLElement | null = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let highestZ = 100;

// パフォーマンス最適化用キャッシュ
let cachedContainerRect: DOMRect | null = null;
let cachedScrollLeft = 0;
let cachedScrollTop = 0;
let startLeft = 0;
let startTop = 0;
let pendingX = 0;
let pendingY = 0;
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
  pendingX = startLeft;
  pendingY = startTop;

  const rect = card.getBoundingClientRect();
  dragOffsetX = e.clientX - rect.left;
  dragOffsetY = e.clientY - rect.top;

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

  // rAFで1フレームに1回だけDOM更新
  if (rafId) return;

  rafId = requestAnimationFrame(() => {
    rafId = 0;
    if (!isDragging || !dragTarget || !cachedContainerRect) return;

    const x = e.clientX - cachedContainerRect.left - dragOffsetX + cachedScrollLeft;
    const y = e.clientY - cachedContainerRect.top - dragOffsetY + cachedScrollTop;

    pendingX = Math.max(0, x);
    pendingY = Math.max(0, y);

    // ドラッグ中はtransformで移動（GPUコンポジット、レイアウト再計算なし）
    const dx = pendingX - startLeft;
    const dy = pendingY - startTop;
    dragTarget.style.transform = `translate(${dx}px, ${dy}px)`;
  });
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
  dragTarget.style.left = `${pendingX}px`;
  dragTarget.style.top = `${pendingY}px`;
  dragTarget.dataset.posX = String(pendingX);
  dragTarget.dataset.posY = String(pendingY);

  dragTarget.classList.remove('card-dragging');

  // 位置をExtensionに送信
  const cardId = dragTarget.dataset.id;
  if (cardId) {
    sendMoveCard(cardId, pendingX, pendingY);
  }

  // スクロールリスナーを除去
  if (dragContainer && scrollHandler) {
    dragContainer.removeEventListener('scroll', scrollHandler);
  }

  isDragging = false;
  dragTarget = null;
  dragContainer = null;
  cachedContainerRect = null;
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
  scrollHandler = null;
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
