import { sendMoveCard, sendCommitFreeformOrder } from './messageHandler';

let isDragging = false;
let dragTarget: HTMLElement | null = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let highestZ = 100;

/** フリーフォームモードを初期化 */
export function initFreeformMode(container: HTMLElement): void {
  container.classList.remove('grid-mode');
  container.classList.add('freeform-mode');

  // カードに初期位置を設定（位置がない場合はグリッド風に配置）
  const cards = container.querySelectorAll<HTMLElement>('.card');
  const cardWidth = 220;
  const cardHeight = 170;
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

  e.preventDefault();
  isDragging = true;
  dragTarget = card;

  const rect = card.getBoundingClientRect();
  dragOffsetX = e.clientX - rect.left;
  dragOffsetY = e.clientY - rect.top;

  // 最前面に持ってくる
  highestZ++;
  card.style.zIndex = String(highestZ);
  card.classList.add('card-dragging');
}

function onMouseMove(e: MouseEvent): void {
  if (!isDragging || !dragTarget) return;

  const container = dragTarget.parentElement;
  if (!container) return;

  const containerRect = container.getBoundingClientRect();
  const x = e.clientX - containerRect.left - dragOffsetX + container.scrollLeft;
  const y = e.clientY - containerRect.top - dragOffsetY + container.scrollTop;

  const clampedX = Math.max(0, x);
  const clampedY = Math.max(0, y);

  dragTarget.style.left = `${clampedX}px`;
  dragTarget.style.top = `${clampedY}px`;
  dragTarget.dataset.posX = String(clampedX);
  dragTarget.dataset.posY = String(clampedY);
}

function onMouseUp(_e: MouseEvent): void {
  if (!isDragging || !dragTarget) return;

  dragTarget.classList.remove('card-dragging');

  // 位置をExtensionに送信
  const cardId = dragTarget.dataset.id;
  const x = parseFloat(dragTarget.dataset.posX || '0');
  const y = parseFloat(dragTarget.dataset.posY || '0');
  if (cardId) {
    sendMoveCard(cardId, x, y);
  }

  isDragging = false;
  dragTarget = null;
}

/** フリーフォームモードを破棄 */
export function destroyFreeformMode(container: HTMLElement): void {
  container.removeEventListener('mousedown', onMouseDown);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
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
