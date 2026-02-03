# Corkboard 実装進捗

## Phase 1: プロジェクトスキャフォールド + 最小Webview
- [x] `package.json`（Extension manifest）作成
- [x] `tsconfig.json` / `tsconfig.webview.json` 作成
- [x] `esbuild.mjs` ビルドスクリプト作成
- [x] `.vscode/launch.json` / `tasks.json` 作成
- [x] `src/extension.ts` — コマンド登録
- [x] `src/CorkboardPanel.ts` — WebviewPanel、HTML生成、CSP
- [x] `webview/main.ts` + CSS — Webview初期化
- [x] npm install + ビルド確認
- [ ] F5デバッグで動作確認

## Phase 2: データモデル + ファイル連携
- [x] `src/types.ts` — 全型定義
- [x] `src/CorkboardDataManager.ts` — .corkboard.json 読み書き
- [x] `src/FileScanner.ts` — ファイルスキャン、先頭行読み取り、frontmatter解析
- [x] `webview/cardRenderer.ts` — カードHTML生成
- [x] `webview/messageHandler.ts` — メッセージ送信ラッパー
- [x] カードクリック → ファイルを開く
- [x] 「ファイルを追加」→ ファイルピッカー → カード追加
- [ ] 動作確認: ファイルがカードとして表示されること

## Phase 3: グリッドモード（ドラッグ&ドロップ）
- [x] `webview/gridMode.ts` — SortableJSでグリッド並べ替え
- [x] 並べ替え → reorderCards → .corkboard.json保存
- [x] カラム数設定（ツールバー）
- [x] カード番号表示
- [ ] 動作確認: ドラッグ並べ替え → リロード後も順序維持

## Phase 4: カード編集（ラベル・ステータス・概要）
- [x] カードコンテキストメニュー
- [x] ラベル設定 → 左端カラーストライプ
- [x] ステータス設定 → 半透明スタンプオーバーレイ
- [x] 概要インライン編集
- [ ] 動作確認: ラベル色表示、ステータススタンプ表示

## Phase 5: フリーフォームモード
- [x] `webview/freeformMode.ts` — カスタムドラッグ
- [x] モード切替ボタン（ツールバー）
- [x] 「順序を確定」ボタン
- [ ] 動作確認: 自由配置 → 確定 → グリッドに反映

## Phase 6: ファイル監視 + 仕上げ
- [x] FileSystemWatcherでファイル削除・変更検知
- [x] .corkboard.jsonの外部変更をリロード
- [ ] キーボードショートカット（Delete: カード削除、Enter: ファイルを開く）
- [x] 空状態UI（カードなし時ガイド表示）
- [x] retainContextWhenHidden: true
- [x] 削除済みファイルのカード警告表示

## Phase 7: ドキュメント + 開発体験
- [x] CLAUDE.md 作成
- [x] TODO.md 作成
- [x] README.md 作成
- [x] .gitignore 作成
- [x] Git初期化 + 初回コミット
- [x] GitHub push

## Phase 8: UI改善 + 新機能
- [x] カード全体カラー表示（ラベル色をカード背景に反映）
- [x] フリーフォームモード安定化（rAF + transform ベースドラッグ）
- [x] 概要・タイトルのインライン編集（ダブルクリック、枠なしtextarea）
- [x] フォルダ単位ファイル取り込み
- [x] 複数コルクボード対応（v2データモデル、ボード作成/切替/リネーム/削除）
- [x] テキストビュー＋MDエクスポート（概要のみ/本文＋概要サブモード、Markdownエクスポート）
