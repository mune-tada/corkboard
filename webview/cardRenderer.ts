import { CardData, FilePreview, LabelDefinition } from './types';

/** ファイル名（パスからbasename抽出） */
function getFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

/** カードの概要テキストを決定 */
export function getSynopsisText(card: CardData, preview: FilePreview | undefined): string {
  if (card.synopsis) return card.synopsis;
  if (preview?.frontmatterSynopsis) return preview.frontmatterSynopsis;
  if (preview?.firstLines) return preview.firstLines;
  return '（概要なし）';
}

/** カードのDOM要素を生成 */
export function createCardElement(
  card: CardData,
  preview: FilePreview | undefined,
  index: number,
  labelColors: LabelDefinition[]
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = card.id;
  el.dataset.order = String(card.order);

  // ラベル色の設定
  const labelDef = card.label ? labelColors.find(l => l.name === card.label) : null;
  if (labelDef) {
    el.style.setProperty('--label-color', labelDef.color);
    el.classList.add('has-label');
  }

  const synopsis = getSynopsisText(card, preview);

  el.innerHTML = `
    <div class="card-label-stripe"></div>
    <div class="card-header">
      <span class="card-number">${index + 1}</span>
      <span class="card-title" title="${card.filePath}">${getFileName(card.filePath)}</span>
      <button class="card-menu-btn" data-id="${card.id}" title="メニュー">⋯</button>
    </div>
    <div class="card-synopsis" data-id="${card.id}">${escapeHtml(synopsis)}</div>
    ${card.status ? `<div class="card-status-stamp">${escapeHtml(card.status)}</div>` : ''}
    <div class="card-footer">
      ${card.status ? `<span class="card-status-badge">${escapeHtml(card.status)}</span>` : ''}
    </div>
  `;

  return el;
}

/** カードの概要部分を更新 */
export function updateCardSynopsis(cardEl: HTMLElement, synopsis: string): void {
  const synopsisEl = cardEl.querySelector('.card-synopsis');
  if (synopsisEl) {
    synopsisEl.textContent = synopsis;
  }
}

/** カードのステータススタンプを更新 */
export function updateCardStatus(cardEl: HTMLElement, status: string | null): void {
  // スタンプの更新
  const existingStamp = cardEl.querySelector('.card-status-stamp');
  if (status) {
    if (existingStamp) {
      existingStamp.textContent = status;
    } else {
      const stamp = document.createElement('div');
      stamp.className = 'card-status-stamp';
      stamp.textContent = status;
      cardEl.appendChild(stamp);
    }
  } else {
    existingStamp?.remove();
  }

  // バッジの更新
  const footer = cardEl.querySelector('.card-footer');
  if (footer) {
    const badge = footer.querySelector('.card-status-badge');
    if (status) {
      if (badge) {
        badge.textContent = status;
      } else {
        const newBadge = document.createElement('span');
        newBadge.className = 'card-status-badge';
        newBadge.textContent = status;
        footer.appendChild(newBadge);
      }
    } else {
      badge?.remove();
    }
  }
}

/** カードのラベル色を更新 */
export function updateCardLabel(cardEl: HTMLElement, labelColor: string | null): void {
  if (labelColor) {
    cardEl.style.setProperty('--label-color', labelColor);
    cardEl.classList.add('has-label');
  } else {
    cardEl.style.removeProperty('--label-color');
    cardEl.classList.remove('has-label');
  }
}

/** HTMLエスケープ */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
