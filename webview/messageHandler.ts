import { VsCodeApi } from './types';

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

/** 表示モード変更 */
export function sendSetViewMode(mode: 'grid' | 'freeform'): void {
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
