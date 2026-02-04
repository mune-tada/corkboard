/** Webview側で使用する型定義（Extension側のtypes.tsと同期） */

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

export interface CardData {
  id: string;
  filePath: string;
  synopsis: string | null;
  label: string | null;
  status: string | null;
  order: number;
  position: { x: number; y: number } | null;
}

export interface LinkData {
  id: string;
  fromId: string;
  toId: string;
  label: string;
}

export interface LabelDefinition {
  name: string;
  color: string;
}

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

export interface FileRelinkUpdate {
  cardId: string;
  oldPath: string;
  newPath: string;
  preview: FilePreview;
}

/** VSCode Webview API */
export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;
