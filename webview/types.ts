/** Webview側で使用する型定義（Extension側のtypes.tsと同期） */

export interface CorkboardConfig {
  viewMode: 'grid' | 'freeform';
  gridColumns: number;
  cardSize: { width: number; height: number };
  cards: CardData[];
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

export interface LabelDefinition {
  name: string;
  color: string;
}

export interface FilePreview {
  filePath: string;
  firstLines: string;
  frontmatterSynopsis: string | null;
}

/** VSCode Webview API */
export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;
