import { CorkboardConfig, CardData, FilePreview, LinkData, FileRelinkUpdate } from './types';
import { createCardElement, getSynopsisText, applyLabelColorVars, removeLabelColorVars } from './cardRenderer';
import { initGridMode, destroyGridMode, updateCardNumbers } from './gridMode';
import { initFreeformMode, destroyFreeformMode, commitFreeformOrder } from './freeformMode';
import { renderTextMode, destroyTextMode, setFileContents, setTextSubMode, getTextSubMode } from './textMode';
import { initConnectorLayer, renderLinks, setConnectMode, setConnectorVisible, clearLinkSelection, updateLinkColor } from './connectors';
import { zoomIn, zoomOut, resetFreeformZoom } from './freeformZoom';
import {
  openFile,
  requestFilePicker,
  sendSetViewMode,
  sendSetGridColumns,
  sendSetCardHeight,
  sendRemoveCard,
  sendUpdateCard,
  sendUpdateSynopsis,
  sendRenameFile,
  requestRelink,
  sendSwitchBoard,
  sendRequestNewBoard,
  sendRequestNewCard,
  sendRequestRenameBoard,
  sendRequestDeleteBoard,
  sendRequestFileContents,
  sendExportMarkdown,
  sendAddLink,
  sendUpdateLink,
  sendRemoveLink,
  sendUndo,
  sendRedo,
} from './messageHandler';

let currentConfig: CorkboardConfig | null = null;
let filePreviews: Map<string, FilePreview> = new Map();

let selectedCardId: string | null = null;
let isConnectMode = false;

const cardHeightPresets = {
  small: { minHeight: 80, lineClamp: 2, freeformMinHeight: 100 },
  medium: { minHeight: 120, lineClamp: 4, freeformMinHeight: 150 },
  large: { minHeight: 200, lineClamp: 8, freeformMinHeight: 220 },
} as const;

function getViewport(): HTMLElement {
  return document.getElementById('corkboard-container')!;
}

function getContent(): HTMLElement {
  return document.getElementById('corkboard-content')!;
}

/** コルクボードを初期化 */
export function initCorkboard(): void {
  setupToolbar();
  setupKeyboardShortcuts();
}

/** コルクボードのデータを読み込んで描画 */
export function loadCorkboard(config: CorkboardConfig, previews: FilePreview[]): void {
  currentConfig = config;
  if (!currentConfig.links) {
    currentConfig.links = [];
  }
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
  const viewport = getViewport();
  const content = getContent();
  const emptyState = document.getElementById('empty-state')!;

  if (!currentConfig || currentConfig.cards.length === 0) {
    content.innerHTML = '';
    emptyState.classList.remove('hidden');
    viewport.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  viewport.classList.remove('hidden');

  if (currentConfig.viewMode !== 'freeform') {
    isConnectMode = false;
  }

  applyCardHeight();

  // 既存モードを破棄
  destroyGridMode();
  destroyFreeformMode(viewport, content);
  destroyTextMode(content);
  setConnectorVisible(false);
  setConnectMode(false);

  viewport.classList.remove('grid-mode', 'freeform-mode', 'freeform-dragging', 'connect-mode', 'reconnect-mode', 'text-mode');
  content.className = '';
  content.innerHTML = '';

  // テキストモードは別レンダリング
  if (currentConfig.viewMode === 'text') {
    viewport.classList.add('text-mode');
    renderTextMode(content, currentConfig.cards, filePreviews);
    return;
  }

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

    // カード選択
    cardEl.addEventListener('click', (e) => {
      // メニューボタンやテキストエリアのクリックは除外
      const target = e.target as HTMLElement;
      if (
        target.closest('.card-menu-btn') ||
        target.closest('.synopsis-edit') ||
        target.closest('.card-connect-handle')
      ) return;

      clearLinkSelection();
      // 前の選択を解除
      content.querySelectorAll('.card-selected').forEach(el => el.classList.remove('card-selected'));
      cardEl.classList.add('card-selected');
      selectedCardId = card.id;
    });

    // 概要ダブルクリック → インライン編集
    cardEl.querySelector('.card-synopsis')?.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      editSynopsis(card, cardEl);
    });

    // タイトルダブルクリック → ファイル名リネーム
    cardEl.querySelector('.card-title')?.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      editTitle(card, cardEl);
    });

    // メニューボタン
    cardEl.querySelector('.card-menu-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showCardMenu(card, cardEl);
    });

    content.appendChild(cardEl);
  });

  // モードに応じた初期化
  if (currentConfig.viewMode === 'grid') {
    initGridMode(viewport, content);
  } else {
    initFreeformMode(viewport, content);
    initConnectorLayer(viewport, content, {
      getLinks: () => currentConfig?.links ?? [],
      getLabelColors: () => currentConfig?.labelColors ?? [],
      onAddLink: addLink,
      onUpdateLink: updateLink,
      onRemoveLink: removeLink,
    });
    setConnectorVisible(true);
    renderLinks(currentConfig.links);
    setConnectMode(isConnectMode);
  }
}

/** ツールバーのイベント設定 */
function setupToolbar(): void {
  // ボードセレクタ
  document.getElementById('board-selector')?.addEventListener('change', (e) => {
    const select = e.target as HTMLSelectElement;
    sendSwitchBoard(select.value);
  });

  // ボード管理ボタン
  document.getElementById('btn-new-board')?.addEventListener('click', () => {
    sendRequestNewBoard();
  });
  document.getElementById('btn-rename-board')?.addEventListener('click', () => {
    sendRequestRenameBoard();
  });
  document.getElementById('btn-delete-board')?.addEventListener('click', () => {
    sendRequestDeleteBoard();
  });

  // ファイル追加ボタン
  document.getElementById('btn-add-files')?.addEventListener('click', () => {
    requestFilePicker();
  });

  // 新規カードボタン
  document.getElementById('btn-new-card')?.addEventListener('click', () => {
    sendRequestNewCard();
  });

  // モード切替ボタン
  document.querySelectorAll<HTMLElement>('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode as 'grid' | 'freeform' | 'text';
      if (currentConfig && currentConfig.viewMode !== mode) {
        currentConfig.viewMode = mode;
        if (mode !== 'freeform') {
          isConnectMode = false;
        }
        sendSetViewMode(mode);
        if (mode === 'text' && getTextSubMode() === 'full') {
          sendRequestFileContents();
        }
        renderCards();
        updateToolbarState();
      }
    });
  });

  // テキストモード: サブモード切替
  document.querySelectorAll<HTMLElement>('.text-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sub = btn.dataset.sub as 'synopsis' | 'full';
      if (getTextSubMode() === sub) return;
      setTextSubMode(sub);
      document.querySelectorAll<HTMLElement>('.text-sub-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.sub === sub);
      });
      if (sub === 'full') {
        sendRequestFileContents();
      }
      if (currentConfig?.viewMode === 'text') {
        renderCards();
      }
    });
  });

  // テキストモード: MDエクスポート
  document.getElementById('btn-export-md')?.addEventListener('click', () => {
    sendExportMarkdown();
  });

  // 順序確定ボタン
  document.getElementById('btn-commit')?.addEventListener('click', () => {
    const content = getContent();
    commitFreeformOrder(content);
  });

  // コネクトモードボタン
  document.getElementById('btn-connect')?.addEventListener('click', () => {
    isConnectMode = !isConnectMode;
    setConnectMode(isConnectMode);
    updateToolbarState();
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

  // カード高さ変更
  document.querySelectorAll<HTMLElement>('.height-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const height = btn.dataset.height as 'small' | 'medium' | 'large';
      if (currentConfig && currentConfig.cardHeight !== height) {
        currentConfig.cardHeight = height;
        sendSetCardHeight(height);
        applyCardHeight();
        updateToolbarState();
      }
    });
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

  // コネクトボタンの表示/非表示
  const connectBtn = document.getElementById('btn-connect')!;
  connectBtn.classList.toggle('hidden', currentConfig.viewMode !== 'freeform');
  connectBtn.classList.toggle('active', isConnectMode);

  // カラム数コントロールの表示/非表示
  const colsControl = document.getElementById('columns-control')!;
  colsControl.classList.toggle('hidden', currentConfig.viewMode !== 'grid');

  // 高さコントロールの表示/非表示
  const heightControl = document.getElementById('height-control')!;
  heightControl.classList.toggle('hidden', currentConfig.viewMode === 'text');

  // テキストモードコントロールの表示/非表示
  const textControls = document.getElementById('text-controls')!;
  textControls.classList.toggle('hidden', currentConfig.viewMode !== 'text');

  // 高さボタンのactive切替
  const activeHeight = currentConfig.cardHeight ?? 'medium';
  document.querySelectorAll<HTMLElement>('.height-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.height === activeHeight);
  });

  updateColumnsDisplay();
  applyGridColumns();
  applyCardHeight();
}

function updateColumnsDisplay(): void {
  const colCount = document.getElementById('col-count');
  if (colCount && currentConfig) {
    colCount.textContent = String(currentConfig.gridColumns);
  }
}

function applyGridColumns(): void {
  const viewport = getViewport();
  if (viewport && currentConfig) {
    viewport.style.setProperty('--grid-columns', String(currentConfig.gridColumns));
  }
}

function applyCardHeight(): void {
  const viewport = getViewport();
  if (!viewport || !currentConfig) return;
  const height = currentConfig.cardHeight ?? 'medium';
  const preset = cardHeightPresets[height] ?? cardHeightPresets.medium;
  viewport.style.setProperty('--card-min-height', `${preset.minHeight}px`);
  viewport.style.setProperty('--card-line-clamp', String(preset.lineClamp));
  viewport.style.setProperty('--card-min-height-freeform', `${preset.freeformMinHeight}px`);
}

function positionPopup(popup: HTMLElement, anchorRect: DOMRect): void {
  const margin = 8;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  popup.style.position = 'fixed';
  popup.style.visibility = 'hidden';
  popup.style.left = `${anchorRect.right}px`;
  popup.style.top = `${anchorRect.bottom}px`;
  document.body.appendChild(popup);

  const popupRect = popup.getBoundingClientRect();
  let left = anchorRect.right;
  let top = anchorRect.bottom;

  if (left + popupRect.width > viewportWidth - margin) {
    left = anchorRect.left - popupRect.width;
  }
  if (top + popupRect.height > viewportHeight - margin) {
    top = anchorRect.top - popupRect.height;
  }

  left = Math.min(Math.max(left, margin), Math.max(margin, viewportWidth - popupRect.width - margin));
  top = Math.min(Math.max(top, margin), Math.max(margin, viewportHeight - popupRect.height - margin));

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
  popup.style.visibility = 'visible';
}

/** カードのコンテキストメニューを表示 */
function showCardMenu(card: CardData, cardEl: HTMLElement): void {
  // 既存メニューを削除
  document.querySelectorAll('.card-context-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'card-context-menu';

  const menuItems = [
    { label: '📄 ファイルを開く', action: () => openFile(card.filePath, card.id) },
    { label: '🔗 再リンク先を変更...', action: () => requestRelink(card.id, card.filePath) },
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
  positionPopup(menu, btnRect);

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
    removeLabelColorVars(cardEl);
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
      applyLabelColorVars(cardEl, labelDef.color);
      picker.remove();
    });
    picker.appendChild(item);
  });

  const btnRect = cardEl.querySelector('.card-menu-btn')!.getBoundingClientRect();
  positionPopup(picker, btnRect);

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
  positionPopup(picker, btnRect);

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

/** タイトル（ファイル名）のインライン編集 */
function editTitle(card: CardData, cardEl: HTMLElement): void {
  const titleEl = cardEl.querySelector('.card-title') as HTMLElement;
  if (!titleEl) return;

  const fullName = card.filePath.split('/').pop() || card.filePath;
  const dotIndex = fullName.lastIndexOf('.');
  const baseName = dotIndex > 0 ? fullName.substring(0, dotIndex) : fullName;

  const input = document.createElement('input');
  input.className = 'title-edit';
  input.type = 'text';
  input.value = baseName;

  const originalText = titleEl.textContent || '';
  titleEl.textContent = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();

  let finished = false;
  const finishEdit = () => {
    if (finished) return;
    finished = true;
    const newValue = input.value.trim();
    if (newValue && newValue !== baseName) {
      sendRenameFile(card.id, card.filePath, newValue);
      // タイトルは fileRenamed メッセージ受信時に更新される
      titleEl.textContent = newValue + (dotIndex > 0 ? fullName.substring(dotIndex) : '');
    } else {
      titleEl.textContent = originalText;
    }
  };

  const cancelEdit = () => {
    if (finished) return;
    finished = true;
    titleEl.textContent = originalText;
  };

  input.addEventListener('blur', finishEdit);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      input.removeEventListener('blur', finishEdit);
      finishEdit();
    } else if (e.key === 'Escape') {
      input.removeEventListener('blur', finishEdit);
      cancelEdit();
    }
  });
}

/** カードを削除 */
function removeCard(card: CardData, cardEl: HTMLElement): void {
  sendRemoveCard(card.id);
  cardEl.remove();

  if (currentConfig) {
    currentConfig.cards = currentConfig.cards.filter(c => c.id !== card.id);
    currentConfig.links = currentConfig.links.filter(l => l.fromId !== card.id && l.toId !== card.id);
    if (currentConfig.cards.length === 0) {
      getViewport().classList.add('hidden');
      document.getElementById('empty-state')!.classList.remove('hidden');
    } else {
      // カード番号を更新
      const content = getContent();
      updateCardNumbers(content);
    }
    renderLinks(currentConfig.links);
  }
}

function addLink(link: LinkData): void {
  if (!currentConfig) return;
  currentConfig.links.push(link);
  sendAddLink(link);
  renderLinks(currentConfig.links);
}

function updateLink(linkId: string, changes: Partial<LinkData>): void {
  if (!currentConfig) return;
  const link = currentConfig.links.find(l => l.id === linkId);
  if (!link) return;
  Object.assign(link, changes);
  sendUpdateLink(linkId, changes);
  const keys = Object.keys(changes);
  if (keys.length === 1 && keys[0] === 'color') {
    updateLinkColor(linkId, link.color ?? null);
    return;
  }
  renderLinks(currentConfig.links);
}

function removeLink(linkId: string): void {
  if (!currentConfig) return;
  currentConfig.links = currentConfig.links.filter(l => l.id !== linkId);
  sendRemoveLink(linkId);
  renderLinks(currentConfig.links);
}

/** ボードセレクタを更新 */
export function updateBoardSelector(boards: string[], activeBoard: string): void {
  const selector = document.getElementById('board-selector') as HTMLSelectElement;
  if (!selector) return;
  selector.innerHTML = '';
  boards.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    opt.selected = name === activeBoard;
    selector.appendChild(opt);
  });
}

/** ファイル変更時のハンドラ — カード概要を更新 */
export function handleFileChanged(filePath: string, preview: FilePreview): void {
  filePreviews.set(filePath, preview);

  if (!currentConfig) return;
  const card = currentConfig.cards.find(c => c.filePath === filePath);
  if (!card) return;

  // カード概要がユーザー設定でない場合のみ更新
  if (!card.synopsis) {
    const content = getContent();
    const cardEl = content.querySelector<HTMLElement>(`[data-id="${card.id}"]`);
    if (cardEl) {
      const synopsisEl = cardEl.querySelector('.card-synopsis');
      if (synopsisEl) {
        synopsisEl.textContent = getSynopsisText(card, preview);
      }
    }
  }
}

/** ファイル削除時のハンドラ — カードに警告表示 */
export function handleFileDeleted(filePath: string): void {
  if (!currentConfig) return;
  const card = currentConfig.cards.find(c => c.filePath === filePath);
  if (!card) return;

  const content = getContent();
  const cardEl = content.querySelector<HTMLElement>(`[data-id="${card.id}"]`);
  if (cardEl) {
    cardEl.classList.add('card-file-deleted');
    const synopsis = cardEl.querySelector('.card-synopsis');
    if (synopsis) {
      synopsis.textContent = '⚠ ファイルが削除されました';
    }
  }
}

/** ファイルリネーム完了時のハンドラ */
export function handleFileRenamed(cardId: string, oldPath: string, newPath: string): void {
  if (!currentConfig) return;
  const card = currentConfig.cards.find(c => c.id === cardId);
  if (!card) return;

  // filePreviews を更新
  const preview = filePreviews.get(oldPath);
  if (preview) {
    filePreviews.delete(oldPath);
    preview.filePath = newPath;
    filePreviews.set(newPath, preview);
  }

  card.filePath = newPath;

  // DOM更新
  const content = getContent();
  const cardEl = content.querySelector<HTMLElement>(`[data-id="${cardId}"]`);
  if (cardEl) {
    const titleEl = cardEl.querySelector('.card-title');
    if (titleEl) {
      const newName = newPath.split('/').pop() || newPath;
      titleEl.textContent = newName;
      titleEl.setAttribute('title', newPath);
    }
  }
}

/** ファイル再リンク完了時のハンドラ */
export function handleFileRelinked(updates: FileRelinkUpdate[]): void {
  if (!currentConfig) return;

  const content = getContent();

  updates.forEach(update => {
    const card = currentConfig!.cards.find(c => c.id === update.cardId);
    if (!card) return;

    const oldPath = update.oldPath;
    const newPath = update.newPath;

    // filePreviews を更新
    if (filePreviews.has(oldPath)) {
      filePreviews.delete(oldPath);
    }
    const preview = { ...update.preview, filePath: newPath };
    filePreviews.set(newPath, preview);

    card.filePath = newPath;

    // DOM更新
    const cardEl = content.querySelector<HTMLElement>(`[data-id="${update.cardId}"]`);
    if (cardEl) {
      cardEl.classList.remove('card-file-deleted');
      const titleEl = cardEl.querySelector('.card-title');
      if (titleEl) {
        const newName = newPath.split('/').pop() || newPath;
        titleEl.textContent = newName;
        titleEl.setAttribute('title', newPath);
      }
      if (!card.synopsis) {
        const synopsisEl = cardEl.querySelector('.card-synopsis');
        if (synopsisEl) {
          synopsisEl.textContent = getSynopsisText(card, preview);
        }
      }
    }
  });

  if (currentConfig.viewMode === 'text') {
    renderTextMode(content, currentConfig.cards, filePreviews);
  }
}

/** ファイル全文受信ハンドラ（テキストモード用） */
export function handleFileContents(contents: { filePath: string; content: string }[]): void {
  setFileContents(contents);
  // テキストモード表示中なら再描画
  if (currentConfig?.viewMode === 'text') {
    const content = getContent();
    renderTextMode(content, currentConfig.cards, filePreviews);
  }
}

/** キーボードショートカットの設定 */
function setupKeyboardShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    const active = document.activeElement as HTMLElement | null;
    const isTextInput = !!active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
    const key = e.key.toLowerCase();

    if (currentConfig?.viewMode === 'freeform' && (e.metaKey || e.ctrlKey) && !e.altKey) {
      if (key === '=' || key === '+') {
        e.preventDefault();
        zoomIn();
        return;
      }
      if (key === '-' || key === '_') {
        e.preventDefault();
        zoomOut();
        return;
      }
      if (key === '0') {
        e.preventDefault();
        resetFreeformZoom();
        return;
      }
    }

    if (!isTextInput) {
      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          sendRedo();
        } else {
          sendUndo();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === 'y') {
        e.preventDefault();
        sendRedo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === 'n') {
        e.preventDefault();
        sendRequestNewCard();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === 'o') {
        e.preventDefault();
        requestFilePicker();
        return;
      }
    }

    // テキスト入力中はカード操作を無視
    if (isTextInput) return;

    if (!currentConfig || !selectedCardId) return;

    const card = currentConfig.cards.find(c => c.id === selectedCardId);
    if (!card) return;

    const content = getContent();
    const cardEl = content.querySelector<HTMLElement>(`[data-id="${selectedCardId}"]`);
    if (!cardEl) return;

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        if (document.querySelector('.link-selected')) return;
        e.preventDefault();
        removeCard(card, cardEl);
        selectedCardId = null;
        break;
      case 'Enter':
        e.preventDefault();
        openFile(card.filePath, card.id);
        break;
      case 'F2':
        e.preventDefault();
        editTitle(card, cardEl);
        break;
    }
  });
}
