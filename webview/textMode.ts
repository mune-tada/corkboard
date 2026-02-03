import { CardData, FilePreview, FileContent } from './types';
import { getSynopsisText } from './cardRenderer';

type TextSubMode = 'synopsis' | 'full';

let currentSubMode: TextSubMode = 'synopsis';
let fileContentsMap: Map<string, string> = new Map();

/** テキストモードのサブモードを取得 */
export function getTextSubMode(): TextSubMode {
  return currentSubMode;
}

/** テキストモードのサブモードを設定 */
export function setTextSubMode(mode: TextSubMode): void {
  currentSubMode = mode;
}

/** ファイル全文データを保存 */
export function setFileContents(contents: FileContent[]): void {
  fileContentsMap.clear();
  contents.forEach(c => fileContentsMap.set(c.filePath, c.content));
}

/** テキストモードを描画 */
export function renderTextMode(
  container: HTMLElement,
  cards: CardData[],
  previews: Map<string, FilePreview>,
): void {
  container.innerHTML = '';
  container.className = 'text-mode-container';

  const sortedCards = [...cards].sort((a, b) => a.order - b.order);

  if (sortedCards.length === 0) {
    container.innerHTML = '<div class="text-empty">カードがありません</div>';
    return;
  }

  sortedCards.forEach((card, index) => {
    const entry = document.createElement('div');
    entry.className = 'text-entry';

    const preview = previews.get(card.filePath);
    const synopsis = getSynopsisText(card, preview);
    const fileName = card.filePath.split('/').pop() || card.filePath;

    // ヘッダー: 番号 + ファイル名
    const header = document.createElement('div');
    header.className = 'text-entry-header';
    header.innerHTML = `<span class="text-entry-number">${index + 1}.</span> <span class="text-entry-filename">${escapeHtml(fileName)}</span>`;
    if (card.filePath !== fileName) {
      const pathSpan = document.createElement('span');
      pathSpan.className = 'text-entry-path';
      pathSpan.textContent = card.filePath;
      header.appendChild(pathSpan);
    }
    entry.appendChild(header);

    // ステータス・ラベル
    if (card.label || card.status) {
      const meta = document.createElement('div');
      meta.className = 'text-entry-meta';
      if (card.label) {
        const labelTag = document.createElement('span');
        labelTag.className = 'text-meta-tag text-meta-label';
        labelTag.textContent = card.label;
        meta.appendChild(labelTag);
      }
      if (card.status) {
        const statusTag = document.createElement('span');
        statusTag.className = 'text-meta-tag text-meta-status';
        statusTag.textContent = card.status;
        meta.appendChild(statusTag);
      }
      entry.appendChild(meta);
    }

    // 概要
    const synopsisEl = document.createElement('div');
    synopsisEl.className = 'text-entry-synopsis';
    synopsisEl.textContent = synopsis;
    entry.appendChild(synopsisEl);

    // 本文（fullモード時）
    if (currentSubMode === 'full') {
      const content = fileContentsMap.get(card.filePath);
      if (content && content !== '（ファイルを読み込めません）') {
        const bodyEl = document.createElement('div');
        bodyEl.className = 'text-entry-body';
        bodyEl.textContent = content;
        entry.appendChild(bodyEl);
      }
    }

    container.appendChild(entry);
  });
}

/** テキストモードを破棄 */
export function destroyTextMode(container: HTMLElement): void {
  container.className = '';
}

/** HTMLエスケープ */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
