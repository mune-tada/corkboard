# Corkboard Extension - Claude Code プロジェクトコンテキスト

## 概要
Scrivener風のコルクボードVSCode拡張機能。ワークスペースのファイルをカード（付箋）として表示し、ドラッグ&ドロップで並べ替え、ラベル・ステータス管理ができる。

## ビルドコマンド
```bash
npm install          # 依存関係インストール
npm run build        # Extension + Webview バンドルビルド
npm run watch        # ウォッチモード（開発用）
npm run package      # .vsixパッケージ作成
```

## デバッグ
- VSCodeで F5 → Extension Development Host が起動
- コマンドパレットで「コルクボードを開く」を実行

## アーキテクチャ

### ディレクトリ構成
```
src/                    ← Extension本体（Node.js, CommonJS）
  extension.ts          ← エントリポイント、コマンド登録
  CorkboardPanel.ts     ← WebviewPanel管理、HTML生成、メッセージルーティング
  CorkboardDataManager.ts ← .corkboard.json 読み書き、ファイル監視
  FileScanner.ts        ← ファイルスキャン、概要（synopsis）読み取り
  types.ts              ← 共有型定義（CorkboardConfig, CardData, メッセージ型）
  utils.ts              ← ユーティリティ（UUID生成、frontmatter解析）

webview/                ← Webview UI（ブラウザターゲット、IIFE）
  main.ts               ← エントリポイント、メッセージ受信
  corkboard.ts          ← コア描画、カード管理、ツールバー制御
  gridMode.ts           ← グリッドモード（SortableJS利用）
  freeformMode.ts       ← フリーフォームモード（カスタムmouse events）
  cardRenderer.ts       ← カードDOM生成
  messageHandler.ts     ← postMessage送信ラッパー
  styles/               ← CSS（main, card, grid, freeform, toolbar）

dist/                   ← ビルド出力（gitignore対象）
  extension.js          ← Extension バンドル
  webview.js            ← Webview バンドル
  webview.css           ← CSS バンドル
```

### ビルドシステム
- `esbuild.mjs` が2つのバンドルを生成
  - `src/extension.ts` → `dist/extension.js` (Node.js, CJS)
  - `webview/main.ts` → `dist/webview.js` (Browser, IIFE)
- CSSは `webview/styles/` を結合して `dist/webview.css` に出力

### データ保存
- `.corkboard.json`（ワークスペースルートに生成）
- カード順序、位置、ラベル、ステータス、概要を保存
- デバウンス保存（500ms）でドラッグ中の過剰書き込みを防止

### Extension ↔ Webview 通信
postMessage によるメッセージパッシング。型は `src/types.ts` に定義。
- Extension → Webview: `loadCorkboard`, `cardAdded`, `fileChanged`, `fileDeleted`, `configReloaded`
- Webview → Extension: `openFile`, `reorderCards`, `moveCard`, `updateCard`, `removeCard`, `setViewMode`, `commitFreeformOrder`, `updateSynopsis`, `requestFilePicker`, `setGridColumns`

### 依存ライブラリ
- `sortablejs` — グリッドモードのドラッグ&ドロップ
- `esbuild` — バンドラ
- `@types/vscode` — VSCode API型定義

## コーディング規約
- TypeScript strict モード
- UIテキストは日本語
- VSCode CSS変数（`--vscode-*`）でテーマ対応
- CSPノンスを使用（Webview HTMLに必須）
