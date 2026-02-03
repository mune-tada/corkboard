import { CorkboardConfig, CardData, FilePreview, LabelDefinition } from './types';
import { createCardElement, getSynopsisText } from './cardRenderer';
import { initGridMode, destroyGridMode, updateCardNumbers } from './gridMode';
import { initFreeformMode, destroyFreeformMode, commitFreeformOrder } from './freeformMode';
import {
  openFile,
  requestFilePicker,
  sendSetViewMode,
  sendSetGridColumns,
  sendRemoveCard,
  sendUpdateCard,
  sendUpdateSynopsis,
} from './messageHandler';

let currentConfig: CorkboardConfig | null = null;
let filePreviews: Map<string, FilePreview> = new Map();

/** コルクボードを初期化 */
export function initCorkboard(): void {
  setupToolbar();
}

/** コルクボードのデータを読み込んで描画 */
export function loadCorkboard(config: CorkboardConfig, previews: FilePreview[]): void {
  currentConfig = config;
  filePreviews.clear();
  previews.forEach(p => filePreviews.set(p.filePath, p));

  renderCards();
  updateToolbarState();
}

/** カードを1枚追加 */
export function addCard(card: CardData, preview: FilePreview): void {
  if (!currentConfig) return;
  currentConfig.cards.push(card);
  filePreviews.set(preview.filePath, preview);
  renderCards();
}

/** 全カードを描画 */
function renderCards(): void {
  const container = document.getElementById('corkboard-container')!;
  const emptyState = document.getElementById('empty-state')!;

  if (!currentConfig || currentConfig.cards.length === 0) {
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
    container.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  container.classList.remove('hidden');

  // 既存モードを破棄
  destroyGridMode();
  destroyFreeformMode(container);

  container.innerHTML = '';

  // カードを順序でソート
  const sortedCards = [...currentConfig.cards].sort((a, b) => a.order - b.order);

  sortedCards.forEach((card, index) => {
    const preview = filePreviews.get(card.filePath);
    const cardEl = createCardElement(card, preview, index, currentConfig!.labelColors);

    // フリーフォーム位置をdata属性に設定
    if (card.position) {
      cardEl.dataset.posX = String(card.position.x);
      cardEl.dataset.posY = String(card.position.y);
    }

    // カードクリック（概要エリアクリックでファイルを開く）
    cardEl.querySelector('.card-synopsis')?.addEventListener('click', () => {
      openFile(card.filePath);
    });

    // メニューボタン
    cardEl.querySelector('.card-menu-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showCardMenu(card, cardEl);
    });

    container.appendChild(cardEl);
  });

  // モードに応じた初期化
  if (currentConfig.viewMode === 'grid') {
    initGridMode(container);
  } else {
    initFreeformMode(container);
  }
}

/** ツールバーのイベント設定 */
function setupToolbar(): void {
  // ファイル追加ボタン
  document.getElementById('btn-add-files')?.addEventListener('click', () => {
    requestFilePicker();
  });

  // モード切替ボタン
  document.querySelectorAll<HTMLElement>('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode as 'grid' | 'freeform';
      if (currentConfig && currentConfig.viewMode !== mode) {
        currentConfig.viewMode = mode;
        sendSetViewMode(mode);
        renderCards();
        updateToolbarState();
      }
    });
  });

  // 順序確定ボタン
  document.getElementById('btn-commit')?.addEventListener('click', () => {
    const container = document.getElementById('corkboard-container')!;
    commitFreeformOrder(container);
  });

  // カラム数変更
  document.getElementById('btn-col-minus')?.addEventListener('click', () => {
    if (currentConfig && currentConfig.gridColumns > 1) {
      currentConfig.gridColumns--;
      sendSetGridColumns(currentConfig.gridColumns);
      updateColumnsDisplay();
      applyGridColumns();
    }
  });

  document.getElementById('btn-col-plus')?.addEventListener('click', () => {
    if (currentConfig && currentConfig.gridColumns < 10) {
      currentConfig.gridColumns++;
      sendSetGridColumns(currentConfig.gridColumns);
      updateColumnsDisplay();
      applyGridColumns();
    }
  });
}

/** ツールバーの状態を更新 */
function updateToolbarState(): void {
  if (!currentConfig) return;

  // モードボタンのactive切替
  document.querySelectorAll<HTMLElement>('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === currentConfig!.viewMode);
  });

  // 順序確定ボタンの表示/非表示
  const commitBtn = document.getElementById('btn-commit')!;
  commitBtn.classList.toggle('hidden', currentConfig.viewMode !== 'freeform');

  // カラム数コントロールの表示/非表示
  const colsControl = document.getElementById('columns-control')!;
  colsControl.classList.toggle('hidden', currentConfig.viewMode !== 'grid');

  updateColumnsDisplay();
  applyGridColumns();
}

function updateColumnsDisplay(): void {
  const colCount = document.getElementById('col-count');
  if (colCount && currentConfig) {
    colCount.textContent = String(currentConfig.gridColumns);
  }
}

function applyGridColumns(): void {
  const container = document.getElementById('corkboard-container');
  if (container && currentConfig) {
    container.style.setProperty('--grid-columns', String(currentConfig.gridColumns));
  }
}

/** カードのコンテキストメニューを表示 */
function showCardMenu(card: CardData, cardEl: HTMLElement): void {
  // 既存メニューを削除
  document.querySelectorAll('.card-context-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'card-context-menu';

  const menuItems = [
    { label: '📄 ファイルを開く', action: () => openFile(card.filePath) },
    { label: '🏷️ ラベルを設定...', action: () => showLabelPicker(card, cardEl) },
    { label: '📋 ステータスを設定...', action: () => showStatusPicker(card, cardEl) },
    { label: '✏️ 概要を編集', action: () => editSynopsis(card, cardEl) },
    { label: '🗑️ カードを削除', action: () => removeCard(card, cardEl) },
  ];

  menuItems.forEach(item => {
    const menuItem = document.createElement('div');
    menuItem.className = 'menu-item';
    menuItem.textContent = item.label;
    menuItem.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      item.action();
    });
    menu.appendChild(menuItem);
  });

  // 位置を計算
  const btnRect = cardEl.querySelector('.card-menu-btn')!.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${btnRect.right}px`;
  menu.style.top = `${btnRect.bottom}px`;

  document.body.appendChild(menu);

  // メニュー外クリックで閉じる
  const closeMenu = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

/** ラベルピッカーを表示 */
function showLabelPicker(card: CardData, cardEl: HTMLElement): void {
  if (!currentConfig) return;

  document.querySelectorAll('.card-context-menu').forEach(m => m.remove());

  const picker = document.createElement('div');
  picker.className = 'card-context-menu label-picker';

  // ラベルなしオプション
  const noneItem = document.createElement('div');
  noneItem.className = 'menu-item';
  noneItem.textContent = '（なし）';
  noneItem.addEventListener('click', () => {
    card.label = null;
    sendUpdateCard(card.id, { label: null });
    cardEl.style.removeProperty('--label-color');
    cardEl.classList.remove('has-label');
    picker.remove();
  });
  picker.appendChild(noneItem);

  currentConfig.labelColors.forEach(labelDef => {
    const item = document.createElement('div');
    item.className = 'menu-item label-item';
    item.innerHTML = `<span class="label-swatch" style="background:${labelDef.color}"></span> ${labelDef.name}`;
    item.addEventListener('click', () => {
      card.label = labelDef.name;
      sendUpdateCard(card.id, { label: labelDef.name });
      cardEl.style.setProperty('--label-color', labelDef.color);
      cardEl.classList.add('has-label');
      picker.remove();
    });
    picker.appendChild(item);
  });

  const btnRect = cardEl.querySelector('.card-menu-btn')!.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.left = `${btnRect.right}px`;
  picker.style.top = `${btnRect.bottom}px`;
  document.body.appendChild(picker);

  setTimeout(() => {
    const close = (e: MouseEvent) => {
      if (!picker.contains(e.target as Node)) {
        picker.remove();
        document.removeEventListener('click', close);
      }
    };
    document.addEventListener('click', close);
  }, 0);
}

/** ステータスピッカーを表示 */
function showStatusPicker(card: CardData, cardEl: HTMLElement): void {
  if (!currentConfig) return;

  document.querySelectorAll('.card-context-menu').forEach(m => m.remove());

  const picker = document.createElement('div');
  picker.className = 'card-context-menu';

  // ステータスなしオプション
  const noneItem = document.createElement('div');
  noneItem.className = 'menu-item';
  noneItem.textContent = '（なし）';
  noneItem.addEventListener('click', () => {
    card.status = null;
    sendUpdateCard(card.id, { status: null });
    const stamp = cardEl.querySelector('.card-status-stamp');
    stamp?.remove();
    const badge = cardEl.querySelector('.card-status-badge');
    badge?.remove();
    picker.remove();
  });
  picker.appendChild(noneItem);

  currentConfig.statusOptions.forEach(status => {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.textContent = status;
    item.addEventListener('click', () => {
      card.status = status;
      sendUpdateCard(card.id, { status });

      // スタンプを更新
      let stamp = cardEl.querySelector('.card-status-stamp');
      if (stamp) {
        stamp.textContent = status;
      } else {
        stamp = document.createElement('div');
        stamp.className = 'card-status-stamp';
        stamp.textContent = status;
        cardEl.appendChild(stamp);
      }

      // バッジを更新
      const footer = cardEl.querySelector('.card-footer')!;
      let badge = footer.querySelector('.card-status-badge');
      if (badge) {
        badge.textContent = status;
      } else {
        badge = document.createElement('span');
        badge.className = 'card-status-badge';
        badge.textContent = status;
        footer.appendChild(badge);
      }

      picker.remove();
    });
    picker.appendChild(item);
  });

  const btnRect = cardEl.querySelector('.card-menu-btn')!.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.left = `${btnRect.right}px`;
  picker.style.top = `${btnRect.bottom}px`;
  document.body.appendChild(picker);

  setTimeout(() => {
    const close = (e: MouseEvent) => {
      if (!picker.contains(e.target as Node)) {
        picker.remove();
        document.removeEventListener('click', close);
      }
    };
    document.addEventListener('click', close);
  }, 0);
}

/** 概要のインライン編集 */
function editSynopsis(card: CardData, cardEl: HTMLElement): void {
  const synopsisEl = cardEl.querySelector('.card-synopsis') as HTMLElement;
  if (!synopsisEl) return;

  const preview = filePreviews.get(card.filePath);
  const currentText = getSynopsisText(card, preview);

  const textarea = document.createElement('textarea');
  textarea.className = 'synopsis-edit';
  textarea.value = card.synopsis || currentText;
  textarea.rows = 4;

  synopsisEl.innerHTML = '';
  synopsisEl.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const finishEdit = () => {
    const newValue = textarea.value.trim();
    card.synopsis = newValue || null;
    sendUpdateSynopsis(card.id, newValue);
    synopsisEl.textContent = newValue || getSynopsisText(card, preview);
  };

  textarea.addEventListener('blur', finishEdit);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      synopsisEl.textContent = getSynopsisText(card, preview);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      finishEdit();
    }
  });
}

/** カードを削除 */
function removeCard(card: CardData, cardEl: HTMLElement): void {
  sendRemoveCard(card.id);
  cardEl.remove();

  if (currentConfig) {
    currentConfig.cards = currentConfig.cards.filter(c => c.id !== card.id);
    if (currentConfig.cards.length === 0) {
      document.getElementById('corkboard-container')!.classList.add('hidden');
      document.getElementById('empty-state')!.classList.remove('hidden');
    } else {
      // カード番号を更新
      const container = document.getElementById('corkboard-container')!;
      updateCardNumbers(container);
    }
  }
}
