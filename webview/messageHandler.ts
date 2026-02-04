import { VsCodeApi, LinkData } from './types';

let vscodeApi: VsCodeApi;

/** VSCode APIを初期化 */
export function initMessageHandler(): VsCodeApi {
  // @ts-ignore - acquireVsCodeApi is provided by the webview runtime
  vscodeApi = acquireVsCodeApi();
  return vscodeApi;
}

/** Extension にメッセージを送信 */
export function postMessage(message: unknown): void {
  vscodeApi.postMessage(message);
}

/** ファイルを開く */
export function openFile(filePath: string): void {
  postMessage({ command: 'openFile', filePath });
}

/** カード順序を送信 */
export function sendReorderCards(cardIds: string[]): void {
  postMessage({ command: 'reorderCards', cardIds });
}

/** カード移動（フリーフォーム） */
export function sendMoveCard(cardId: string, x: number, y: number): void {
  postMessage({ command: 'moveCard', cardId, position: { x, y } });
}

/** カード更新 */
export function sendUpdateCard(cardId: string, changes: Record<string, unknown>): void {
  postMessage({ command: 'updateCard', cardId, changes });
}

/** カード削除 */
export function sendRemoveCard(cardId: string): void {
  postMessage({ command: 'removeCard', cardId });
}

/** リンク追加 */
export function sendAddLink(link: LinkData): void {
  postMessage({ command: 'addLink', link });
}

/** リンク更新 */
export function sendUpdateLink(linkId: string, changes: Partial<LinkData>): void {
  postMessage({ command: 'updateLink', linkId, changes });
}

/** リンク削除 */
export function sendRemoveLink(linkId: string): void {
  postMessage({ command: 'removeLink', linkId });
}

/** 表示モード変更 */
export function sendSetViewMode(mode: 'grid' | 'freeform' | 'text'): void {
  postMessage({ command: 'setViewMode', mode });
}

/** フリーフォーム順序確定 */
export function sendCommitFreeformOrder(cardIds: string[]): void {
  postMessage({ command: 'commitFreeformOrder', cardIds });
}

/** 概要更新 */
export function sendUpdateSynopsis(cardId: string, synopsis: string): void {
  postMessage({ command: 'updateSynopsis', cardId, synopsis });
}

/** ファイルピッカーリクエスト */
export function requestFilePicker(): void {
  postMessage({ command: 'requestFilePicker' });
}

/** グリッドカラム数変更 */
export function sendSetGridColumns(columns: number): void {
  postMessage({ command: 'setGridColumns', columns });
}

/** カード高さ変更 */
export function sendSetCardHeight(height: 'small' | 'medium' | 'large'): void {
  postMessage({ command: 'setCardHeight', height });
}

/** ファイルリネーム */
export function sendRenameFile(cardId: string, oldPath: string, newFileName: string): void {
  postMessage({ command: 'renameFile', cardId, oldPath, newFileName });
}

/** ボード切替 */
export function sendSwitchBoard(name: string): void {
  postMessage({ command: 'switchBoard', name });
}

/** 新規ボード作成リクエスト */
export function sendRequestNewBoard(): void {
  postMessage({ command: 'requestNewBoard' });
}

/** 新規カード作成リクエスト */
export function sendRequestNewCard(): void {
  postMessage({ command: 'requestNewCard' });
}

/** ボード名変更リクエスト */
export function sendRequestRenameBoard(): void {
  postMessage({ command: 'requestRenameBoard' });
}

/** ボード削除リクエスト */
export function sendRequestDeleteBoard(): void {
  postMessage({ command: 'requestDeleteBoard' });
}

/** ファイル全文リクエスト（テキストモード用） */
export function sendRequestFileContents(): void {
  postMessage({ command: 'requestFileContents' });
}

/** Markdownエクスポートリクエスト */
export function sendExportMarkdown(): void {
  postMessage({ command: 'exportMarkdown' });
}

/** 元に戻す */
export function sendUndo(): void {
  postMessage({ command: 'undo' });
}

/** やり直し */
export function sendRedo(): void {
  postMessage({ command: 'redo' });
}
