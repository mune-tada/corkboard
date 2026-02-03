/** .corkboard.json のルート設定 */
export interface CorkboardConfig {
  version: 1;
  viewMode: 'grid' | 'freeform';
  gridColumns: number;
  cardSize: { width: number; height: number };
  cards: CardData[];
  labelColors: LabelDefinition[];
  statusOptions: string[];
}

/** コルクボード上の1枚のカード */
export interface CardData {
  id: string;
  filePath: string;
  synopsis: string | null;
  label: string | null;
  status: string | null;
  order: number;
  position: { x: number; y: number } | null;
}

/** ラベル定義 */
export interface LabelDefinition {
  name: string;
  color: string;
}

/** ファイルプレビュー（Webviewに送る自動概要データ） */
export interface FilePreview {
  filePath: string;
  firstLines: string;
  frontmatterSynopsis: string | null;
}

/** Extension → Webview メッセージ */
export type ExtensionToWebviewMessage =
  | { command: 'loadCorkboard'; data: CorkboardConfig; filePreviews: FilePreview[] }
  | { command: 'cardAdded'; card: CardData; preview: FilePreview }
  | { command: 'fileChanged'; filePath: string; preview: FilePreview }
  | { command: 'fileDeleted'; filePath: string }
  | { command: 'configReloaded'; data: CorkboardConfig; filePreviews: FilePreview[] }
  | { command: 'fileRenamed'; cardId: string; oldPath: string; newPath: string };

/** Webview → Extension メッセージ */
export type WebviewToExtensionMessage =
  | { command: 'openFile'; filePath: string }
  | { command: 'reorderCards'; cardIds: string[] }
  | { command: 'moveCard'; cardId: string; position: { x: number; y: number } }
  | { command: 'updateCard'; cardId: string; changes: Partial<CardData> }
  | { command: 'removeCard'; cardId: string }
  | { command: 'setViewMode'; mode: 'grid' | 'freeform' }
  | { command: 'commitFreeformOrder'; cardIds: string[] }
  | { command: 'updateSynopsis'; cardId: string; synopsis: string }
  | { command: 'requestFilePicker' }
  | { command: 'setGridColumns'; columns: number }
  | { command: 'renameFile'; cardId: string; oldPath: string; newFileName: string };

/** デフォルト設定 */
export function createDefaultConfig(): CorkboardConfig {
  return {
    version: 1,
    viewMode: 'grid',
    gridColumns: 4,
    cardSize: { width: 200, height: 150 },
    cards: [],
    labelColors: [
      { name: '赤', color: '#e74c3c' },
      { name: 'オレンジ', color: '#e67e22' },
      { name: '黄', color: '#f1c40f' },
      { name: '緑', color: '#2ecc71' },
      { name: '青', color: '#3498db' },
      { name: '紫', color: '#9b59b6' },
    ],
    statusOptions: ['未着手', '下書き', '推敲中', '完成'],
  };
}
