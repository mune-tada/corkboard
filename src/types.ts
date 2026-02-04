/** 1つのボードの設定 */
export interface CorkboardConfig {
  viewMode: 'grid' | 'freeform' | 'text';
  gridColumns: number;
  cardHeight: 'small' | 'medium' | 'large';
  cardSize: { width: number; height: number };
  cards: CardData[];
  links: LinkData[];
  labelColors: LabelDefinition[];
  statusOptions: string[];
}

/** v2: 複数ボード対応のルート設定 (.corkboard.json) */
export interface CorkboardRootConfig {
  version: 2;
  activeBoard: string;
  boards: Record<string, CorkboardConfig>;
}

/** v1: 後方互換（読み込み用） */
export interface CorkboardConfigV1 {
  version: 1;
  viewMode: 'grid' | 'freeform' | 'text';
  gridColumns: number;
  cardHeight?: 'small' | 'medium' | 'large';
  cardSize: { width: number; height: number };
  cards: CardData[];
  links?: LinkData[];
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

/** カード間リンク */
export interface LinkData {
  id: string;
  fromId: string;
  toId: string;
  label: string;
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

/** ファイル全文データ（テキストモード用） */
export interface FileContent {
  filePath: string;
  content: string;
}

/** Extension → Webview メッセージ */
export type ExtensionToWebviewMessage =
  | { command: 'loadCorkboard'; data: CorkboardConfig; filePreviews: FilePreview[] }
  | { command: 'cardAdded'; card: CardData; preview: FilePreview }
  | { command: 'fileChanged'; filePath: string; preview: FilePreview }
  | { command: 'fileDeleted'; filePath: string }
  | { command: 'configReloaded'; data: CorkboardConfig; filePreviews: FilePreview[] }
  | { command: 'fileRenamed'; cardId: string; oldPath: string; newPath: string }
  | { command: 'boardList'; boards: string[]; activeBoard: string }
  | { command: 'fileContents'; contents: FileContent[] };

/** Webview → Extension メッセージ */
export type WebviewToExtensionMessage =
  | { command: 'openFile'; filePath: string }
  | { command: 'reorderCards'; cardIds: string[] }
  | { command: 'moveCard'; cardId: string; position: { x: number; y: number } }
  | { command: 'updateCard'; cardId: string; changes: Partial<CardData> }
  | { command: 'removeCard'; cardId: string }
  | { command: 'addLink'; link: LinkData }
  | { command: 'updateLink'; linkId: string; changes: Partial<LinkData> }
  | { command: 'removeLink'; linkId: string }
  | { command: 'setViewMode'; mode: 'grid' | 'freeform' | 'text' }
  | { command: 'commitFreeformOrder'; cardIds: string[] }
  | { command: 'updateSynopsis'; cardId: string; synopsis: string }
  | { command: 'requestFilePicker' }
  | { command: 'setGridColumns'; columns: number }
  | { command: 'setCardHeight'; height: 'small' | 'medium' | 'large' }
  | { command: 'renameFile'; cardId: string; oldPath: string; newFileName: string }
  | { command: 'switchBoard'; name: string }
  | { command: 'requestNewBoard' }
  | { command: 'requestNewCard' }
  | { command: 'requestRenameBoard' }
  | { command: 'requestDeleteBoard' }
  | { command: 'requestFileContents' }
  | { command: 'exportMarkdown' };

/** デフォルトのボード設定を生成 */
export function createDefaultBoardConfig(): CorkboardConfig {
  return {
    viewMode: 'grid',
    gridColumns: 4,
    cardHeight: 'medium',
    cardSize: { width: 200, height: 150 },
    cards: [],
    links: [],
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

/** デフォルトのルート設定を生成 */
export function createDefaultConfig(): CorkboardRootConfig {
  return {
    version: 2,
    activeBoard: 'メインボード',
    boards: {
      'メインボード': createDefaultBoardConfig(),
    },
  };
}
