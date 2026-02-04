import * as vscode from 'vscode';
import * as path from 'path';
import { CorkboardDataManager } from './CorkboardDataManager';
import { FileScanner } from './FileScanner';
import { CorkboardRootConfig, WebviewToExtensionMessage } from './types';
import { getNonce } from './utils';

export class CorkboardPanel {
  public static currentPanel: CorkboardPanel | undefined;
  private static readonly viewType = 'corkboard';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly dataManager: CorkboardDataManager;
  private readonly fileScanner: FileScanner;
  private readonly disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, workspaceRoot: string): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (CorkboardPanel.currentPanel) {
      CorkboardPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CorkboardPanel.viewType,
      'コルクボード',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      }
    );

    CorkboardPanel.currentPanel = new CorkboardPanel(panel, extensionUri, workspaceRoot);
  }

  /** 外部からカードを追加する */
  public static async addFileToBoard(filePath: string): Promise<void> {
    if (!CorkboardPanel.currentPanel) return;
    const panel = CorkboardPanel.currentPanel;
    const card = panel.dataManager.addCard(filePath);
    const preview = await panel.fileScanner.getFilePreview(filePath);
    panel.panel.webview.postMessage({
      command: 'cardAdded',
      card,
      preview,
    });
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly workspaceRoot: string
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.dataManager = new CorkboardDataManager(workspaceRoot);
    this.fileScanner = new FileScanner(workspaceRoot);

    // .corkboard.json の外部変更でリロード
    this.dataManager.setOnConfigChanged(async () => {
      await this.sendFullState();
    });

    this.panel.webview.html = this.getHtmlForWebview();
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // ワークスペースファイルの変更監視
    this.setupFileWatcher();

    // 初期データを送信
    this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.sendFullState();
  }

  private async sendFullState(): Promise<void> {
    const config = await this.dataManager.load();
    const filePaths = config.cards.map(c => c.filePath);
    const filePreviews = await this.fileScanner.getFilePreviews(filePaths);
    this.panel.webview.postMessage({
      command: 'loadCorkboard',
      data: config,
      filePreviews,
    });
    this.sendBoardList();
  }

  private async sendFullStateAndBoardList(): Promise<void> {
    const config = this.dataManager.getConfig();
    const filePaths = config.cards.map(c => c.filePath);
    const filePreviews = await this.fileScanner.getFilePreviews(filePaths);
    this.panel.webview.postMessage({
      command: 'loadCorkboard',
      data: config,
      filePreviews,
    });
    this.sendBoardList();
  }

  private sendBoardList(): void {
    this.panel.webview.postMessage({
      command: 'boardList',
      boards: this.dataManager.getBoardNames(),
      activeBoard: this.dataManager.getActiveBoard(),
    });
  }

  private async handleMessage(msg: WebviewToExtensionMessage): Promise<void> {
    switch (msg.command) {
      case 'openFile': {
        await this.handleOpenFileRequest(msg.filePath, msg.cardId);
        break;
      }
      case 'requestRelink':
        await this.handleRelinkRequest(msg.cardId, msg.filePath);
        break;
      case 'reorderCards':
        this.dataManager.reorderCards(msg.cardIds);
        break;
      case 'moveCard':
        this.dataManager.updateCard(msg.cardId, { position: msg.position });
        break;
      case 'updateCard':
        this.dataManager.updateCard(msg.cardId, msg.changes);
        break;
      case 'removeCard':
        this.dataManager.removeCard(msg.cardId);
        break;
      case 'addLink':
        this.dataManager.addLink(msg.link);
        break;
      case 'updateLink':
        this.dataManager.updateLink(msg.linkId, msg.changes);
        break;
      case 'removeLink':
        this.dataManager.removeLink(msg.linkId);
        break;
      case 'setViewMode':
        this.dataManager.setViewMode(msg.mode);
        if (msg.mode === 'text') {
          await this.sendFileContents();
        }
        break;
      case 'commitFreeformOrder':
        this.dataManager.reorderCards(msg.cardIds);
        break;
      case 'updateSynopsis':
        this.dataManager.updateCard(msg.cardId, { synopsis: msg.synopsis });
        break;
      case 'requestFilePicker':
        await this.showFilePicker();
        break;
      case 'setGridColumns':
        this.dataManager.setGridColumns(msg.columns);
        break;
      case 'setCardHeight':
        this.dataManager.setCardHeight(msg.height);
        break;
      case 'renameFile':
        await this.handleRenameFile(msg.cardId, msg.oldPath, msg.newFileName);
        break;
      case 'switchBoard':
        this.dataManager.switchBoard(msg.name);
        await this.sendFullStateAndBoardList();
        break;
      case 'requestNewBoard': {
        const name = await vscode.window.showInputBox({ prompt: '新しいボード名を入力', placeHolder: 'ボード名' });
        if (name) {
          this.dataManager.createBoard(name);
          this.dataManager.switchBoard(name);
          await this.sendFullStateAndBoardList();
        }
        break;
      }
      case 'requestNewCard':
        await this.handleNewCard();
        break;
      case 'requestRenameBoard': {
        const currentName = this.dataManager.getActiveBoard();
        const newName = await vscode.window.showInputBox({ prompt: 'ボード名を変更', value: currentName });
        if (newName && newName !== currentName) {
          this.dataManager.renameBoard(currentName, newName);
          this.sendBoardList();
        }
        break;
      }
      case 'requestFileContents':
        await this.sendFileContents();
        break;
      case 'exportMarkdown':
        await this.handleExportMarkdown();
        break;
      case 'undo': {
        const before = this.dataManager.getRootConfigSnapshot();
        const changed = await this.dataManager.undo();
        if (changed) {
          const after = this.dataManager.getRootConfigSnapshot();
          await this.reconcileFileRenames(before, after);
          await this.sendFullStateAndBoardList();
        }
        break;
      }
      case 'redo': {
        const before = this.dataManager.getRootConfigSnapshot();
        const changed = await this.dataManager.redo();
        if (changed) {
          const after = this.dataManager.getRootConfigSnapshot();
          await this.reconcileFileRenames(before, after);
          await this.sendFullStateAndBoardList();
        }
        break;
      }
      case 'requestDeleteBoard': {
        const boards = this.dataManager.getBoardNames();
        if (boards.length <= 1) {
          vscode.window.showWarningMessage('最後のボードは削除できません。');
          break;
        }
        const active = this.dataManager.getActiveBoard();
        const confirm = await vscode.window.showWarningMessage(
          `ボード「${active}」を削除しますか？`,
          { modal: true },
          '削除'
        );
        if (confirm === '削除') {
          this.dataManager.deleteBoard(active);
          await this.sendFullStateAndBoardList();
        }
        break;
      }
    }
  }

  private resolveFileUri(filePath: string): vscode.Uri {
    if (filePath.startsWith('file://')) {
      return vscode.Uri.parse(filePath);
    }
    const normalized = path.normalize(filePath);
    if (path.isAbsolute(normalized)) {
      return vscode.Uri.file(normalized);
    }
    return vscode.Uri.file(path.join(this.workspaceRoot, normalized));
  }

  private async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private async openDocument(uri: vscode.Uri): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`ファイルを開けませんでした: ${errorMsg}`);
    }
  }

  private async handleOpenFileRequest(filePath: string, _cardId?: string): Promise<void> {
    const uri = this.resolveFileUri(filePath);
    if (await this.fileExists(uri)) {
      await this.openDocument(uri);
      return;
    }

    // 存在しない場合は警告表示
    this.panel.webview.postMessage({
      command: 'fileDeleted',
      filePath,
    });

    const newPath = await this.promptRelinkTarget(filePath, { forcePick: false });
    if (!newPath) return;

    const relinked = await this.applyRelink(filePath, newPath);
    if (relinked) {
      const newUri = this.resolveFileUri(newPath);
      await this.openDocument(newUri);
    }
  }

  private async handleRelinkRequest(_cardId: string, filePath: string): Promise<void> {
    const newPath = await this.promptRelinkTarget(filePath, { forcePick: true });
    if (!newPath) return;
    await this.applyRelink(filePath, newPath);
  }

  private async promptRelinkTarget(
    oldPath: string,
    options: { forcePick: boolean }
  ): Promise<string | undefined> {
    const candidates = await this.findRelinkCandidates(oldPath, options.forcePick);

    if (candidates.length === 0) {
      return await this.showRelinkFilePicker();
    }

    if (candidates.length === 1 && !options.forcePick) {
      return candidates[0];
    }

    return await this.showRelinkCandidatePicker(candidates);
  }

  private async findRelinkCandidates(oldPath: string, excludeCurrent: boolean): Promise<string[]> {
    const baseName = path.basename(oldPath);
    if (!baseName) return [];
    const uris = await vscode.workspace.findFiles(`**/${baseName}`, '**/node_modules/**', 200);
    let candidates = uris.map(uri => path.relative(this.workspaceRoot, uri.fsPath));
    if (excludeCurrent) {
      candidates = candidates.filter(c => c !== oldPath);
    }
    return this.sortRelinkCandidates(oldPath, candidates);
  }

  private sortRelinkCandidates(oldPath: string, candidates: string[]): string[] {
    return [...candidates].sort((a, b) => {
      const scoreDiff = this.scorePathSimilarity(oldPath, b) - this.scorePathSimilarity(oldPath, a);
      if (scoreDiff !== 0) return scoreDiff;
      return a.localeCompare(b);
    });
  }

  private scorePathSimilarity(oldPath: string, candidate: string): number {
    const oldParts = oldPath.split(/[\\/]/).filter(Boolean);
    const candParts = candidate.split(/[\\/]/).filter(Boolean);
    const max = Math.min(oldParts.length, candParts.length);
    let suffixMatches = 0;
    for (let i = 1; i <= max; i++) {
      if (oldParts[oldParts.length - i] === candParts[candParts.length - i]) {
        suffixMatches += 1;
      } else {
        break;
      }
    }
    const depthDiff = Math.abs(oldParts.length - candParts.length);
    return suffixMatches * 2 - depthDiff;
  }

  private async showRelinkCandidatePicker(candidates: string[]): Promise<string | undefined> {
    type RelinkPickItem = vscode.QuickPickItem & { value: string };
    const items: RelinkPickItem[] = candidates.map((candidate, index) => ({
      label: path.basename(candidate) || candidate,
      description: candidate,
      detail: index === 0 ? 'おすすめ' : undefined,
      value: candidate,
    }));

    items.push({
      label: '📂 ファイルを選択...',
      description: '別のファイルを指定',
      value: '__pick__',
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '再リンク先のファイルを選択',
    });

    if (!selected) return;
    if (selected.value === '__pick__') {
      return await this.showRelinkFilePicker();
    }
    return selected.value;
  }

  private async showRelinkFilePicker(): Promise<string | undefined> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(this.workspaceRoot),
      openLabel: 'ファイルを選択',
    });

    if (!uris || uris.length === 0) return;

    const rel = path.relative(this.workspaceRoot, uris[0].fsPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      vscode.window.showWarningMessage('ワークスペース外のファイルは選択できません。');
      return;
    }

    return rel;
  }

  private async applyRelink(oldPath: string, newPath: string): Promise<boolean> {
    if (oldPath === newPath) return false;

    const boards = this.dataManager.getBoardsContainingFilePath(oldPath);
    if (boards.length === 0) return false;

    let scope: 'active' | 'all' = 'active';
    if (boards.length > 1) {
      const pick = await vscode.window.showQuickPick([
        { label: '全ボード', description: '同じファイル参照をすべて更新', value: 'all' as const },
        { label: '現在のボードのみ', description: 'アクティブボードだけ更新', value: 'active' as const },
      ], { placeHolder: '再リンクの更新範囲を選択' });
      if (!pick) return false;
      scope = pick.value;
    }

    const updatedCardIds = this.dataManager.updateFilePath(oldPath, newPath, scope);
    if (updatedCardIds.length === 0) return false;

    const preview = await this.fileScanner.getFilePreview(newPath);
    const updates = updatedCardIds.map(cardId => ({
      cardId,
      oldPath,
      newPath,
      preview,
    }));

    this.panel.webview.postMessage({
      command: 'fileRelinked',
      updates,
    });

    if (this.dataManager.getConfig().viewMode === 'text') {
      await this.sendFileContents();
    }

    return true;
  }

  private async showFilePicker(): Promise<void> {
    // ファイル追加方法を選択
    const choice = await vscode.window.showQuickPick([
      { label: '📄 ファイルを選択', description: '個別のファイルを選ぶ', value: 'file' as const },
      { label: '📁 フォルダを選択', description: 'フォルダ内のすべての対象ファイルを追加', value: 'folder' as const },
    ], { placeHolder: '追加方法を選択' });

    if (!choice) return;

    if (choice.value === 'folder') {
      await this.showFolderPicker();
    } else {
      await this.showIndividualFilePicker();
    }
  }

  private async showIndividualFilePicker(): Promise<void> {
    const eligible = await this.fileScanner.listEligibleFiles();
    const config = this.dataManager.getConfig();
    const existingPaths = new Set(config.cards.map(c => c.filePath));
    const available = eligible.filter(f => !existingPaths.has(f));

    if (available.length === 0) {
      vscode.window.showInformationMessage('追加できるファイルがありません。');
      return;
    }

    const items = available.map(f => ({
      label: path.basename(f),
      description: f,
      filePath: f,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'コルクボードに追加するファイルを選択',
      canPickMany: true,
    });

    if (selected) {
      await this.addFilesToBoard(selected.map(s => s.filePath));
    }
  }

  private async showFolderPicker(): Promise<void> {
    const folderUris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(this.workspaceRoot),
      openLabel: 'フォルダを追加',
    });

    if (!folderUris || folderUris.length === 0) return;

    const folderRelative = path.relative(this.workspaceRoot, folderUris[0].fsPath);
    const eligible = await this.fileScanner.listEligibleFilesInFolder(folderRelative);
    const config = this.dataManager.getConfig();
    const existingPaths = new Set(config.cards.map(c => c.filePath));
    const newFiles = eligible.filter(f => !existingPaths.has(f));

    if (newFiles.length === 0) {
      vscode.window.showInformationMessage('追加できるファイルがありません。');
      return;
    }

    await this.addFilesToBoard(newFiles);
    vscode.window.showInformationMessage(`${newFiles.length}件のファイルを追加しました。`);
  }

  /** テキストモード用にファイル全文を送信 */
  private async sendFileContents(): Promise<void> {
    const config = this.dataManager.getConfig();
    const filePaths = config.cards.map(c => c.filePath);
    const contents = await this.fileScanner.getFileContents(filePaths);
    this.panel.webview.postMessage({
      command: 'fileContents',
      contents,
    });
  }

  /** Markdownエクスポート */
  private async handleExportMarkdown(): Promise<void> {
    const config = this.dataManager.getConfig();
    const sortedCards = [...config.cards].sort((a, b) => a.order - b.order);
    const filePaths = sortedCards.map(c => c.filePath);
    const previews = await this.fileScanner.getFilePreviews(filePaths);
    const contents = await this.fileScanner.getFileContents(filePaths);

    const previewMap = new Map(previews.map(p => [p.filePath, p]));
    const contentMap = new Map(contents.map(c => [c.filePath, c]));

    const lines: string[] = [];
    sortedCards.forEach((card, i) => {
      const fileName = path.basename(card.filePath);
      lines.push(`## ${i + 1}. ${fileName}`);
      lines.push('');

      const preview = previewMap.get(card.filePath);
      const synopsis = card.synopsis
        || preview?.frontmatterSynopsis
        || preview?.firstLines
        || '';
      if (synopsis) {
        synopsis.split('\n').forEach(line => {
          lines.push(`> ${line}`);
        });
        lines.push('');
      }

      const fileContent = contentMap.get(card.filePath);
      if (fileContent && fileContent.content !== '（ファイルを読み込めません）') {
        lines.push(fileContent.content);
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    });

    const mdContent = lines.join('\n');

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(this.workspaceRoot, 'export.md')),
      filters: { 'Markdown': ['md'] },
    });

    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(mdContent, 'utf-8'));
      vscode.window.showInformationMessage(`Markdownをエクスポートしました: ${path.basename(uri.fsPath)}`);
    }
  }

  private async addFilesToBoard(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      const card = this.dataManager.addCard(filePath);
      const preview = await this.fileScanner.getFilePreview(filePath);
      this.panel.webview.postMessage({
        command: 'cardAdded',
        card,
        preview,
      });
    }
  }

  /** 新規カード作成 */
  private async handleNewCard(): Promise<void> {
    const input = await vscode.window.showInputBox({
      prompt: '新しいカードのファイル名を入力',
      placeHolder: '例: ideas.md',
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return 'ファイル名を入力してください。';
        const sanitized = trimmed.replace(/[\\/]+/g, path.sep);
        if (path.isAbsolute(sanitized)) return 'ワークスペース内の相対パスで入力してください。';
        if (sanitized.endsWith(path.sep)) return 'ファイル名を入力してください。';
        const segments = sanitized.split(path.sep);
        if (segments.includes('..')) return 'ワークスペース外は指定できません。';
        if (/[<>:"|?*\x00-\x1F]/.test(sanitized)) return '使用できない文字が含まれています。';
        if (sanitized === '.' || sanitized === '') return 'ファイル名を入力してください。';
        return null;
      },
    });

    if (!input) return;

    let filePath = input.trim().replace(/[\\/]+/g, path.sep);
    const ext = path.extname(filePath);
    if (!ext || ext === '.') {
      filePath = filePath.replace(/\.$/, '') + '.md';
    }
    filePath = path.normalize(filePath);

    const config = this.dataManager.getConfig();
    const existingCard = config.cards.find(c => c.filePath === filePath);
    const uri = vscode.Uri.file(path.join(this.workspaceRoot, filePath));

    let exists = false;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      exists = true;
      if (stat.type & vscode.FileType.Directory) {
        vscode.window.showErrorMessage('同名のフォルダが存在します。');
        return;
      }
    } catch {
      // not found
    }

    if (exists && existingCard) {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      vscode.window.showInformationMessage('このファイルは既にカードに追加されています。');
      return;
    }

    if (exists) {
      const confirm = await vscode.window.showWarningMessage(
        `ファイル「${filePath}」は既に存在します。カードに追加しますか？`,
        { modal: true },
        '追加'
      );
      if (confirm !== '追加') return;
    } else {
      try {
        await vscode.workspace.fs.writeFile(uri, Buffer.from('', 'utf-8'));
      } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`ファイルの作成に失敗しました: ${errorMsg}`);
        return;
      }
    }

    if (existingCard) {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      vscode.window.showInformationMessage('このファイルは既にカードに追加されています。');
      return;
    }

    const card = this.dataManager.addCard(filePath);
    const preview = await this.fileScanner.getFilePreview(filePath);
    this.panel.webview.postMessage({
      command: 'cardAdded',
      card,
      preview,
    });

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }

  private getHtmlForWebview(): string {
    const webview = this.panel.webview;
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css')
    );

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>コルクボード</title>
</head>
<body>
  <div id="toolbar">
    <div class="toolbar-left">
      <select id="board-selector" class="toolbar-select" title="ボードを選択"></select>
      <button id="btn-new-board" class="toolbar-btn-small" title="新しいボード">＋</button>
      <button id="btn-rename-board" class="toolbar-btn-small" title="ボード名変更">✎</button>
      <button id="btn-delete-board" class="toolbar-btn-small" title="ボードを削除">✕</button>
      <div class="toolbar-separator"></div>
      <button id="btn-add-files" class="toolbar-btn" title="ファイルを追加">＋ ファイルを追加</button>
      <button id="btn-new-card" class="toolbar-btn" title="新規カードを作成">＋ 新規カード</button>
      <div class="toolbar-separator"></div>
      <button id="btn-grid" class="toolbar-btn mode-btn active" data-mode="grid" title="グリッドモード">グリッド</button>
      <button id="btn-freeform" class="toolbar-btn mode-btn" data-mode="freeform" title="フリーフォームモード">フリーフォーム</button>
      <button id="btn-text" class="toolbar-btn mode-btn" data-mode="text" title="テキストモード">テキスト</button>
    </div>
    <div class="toolbar-right">
      <button id="btn-commit" class="toolbar-btn hidden" title="現在の配置から順序を確定">順序を確定</button>
      <button id="btn-connect" class="toolbar-btn hidden" title="カードを接続">コネクト</button>
      <label class="toolbar-label" id="columns-control">
        カラム:
        <button id="btn-col-minus" class="toolbar-btn-small">−</button>
        <span id="col-count">4</span>
        <button id="btn-col-plus" class="toolbar-btn-small">＋</button>
      </label>
      <label class="toolbar-label" id="height-control">
        高さ:
        <button class="toolbar-btn-small height-btn" data-height="small">S</button>
        <button class="toolbar-btn-small height-btn active" data-height="medium">M</button>
        <button class="toolbar-btn-small height-btn" data-height="large">L</button>
      </label>
      <div id="text-controls" class="hidden">
        <button id="btn-text-synopsis" class="toolbar-btn text-sub-btn active" data-sub="synopsis" title="概要のみ">概要のみ</button>
        <button id="btn-text-full" class="toolbar-btn text-sub-btn" data-sub="full" title="本文＋概要">本文＋概要</button>
        <div class="toolbar-separator"></div>
        <button id="btn-export-md" class="toolbar-btn" title="Markdownでエクスポート">MDエクスポート</button>
      </div>
    </div>
  </div>
  <div id="corkboard-container"></div>
  <div id="empty-state" class="hidden">
    <p>カードがありません</p>
    <p>「＋ ファイルを追加」または「＋ 新規カード」でカードを追加できます</p>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /** ファイルリネーム処理 */
  private async handleRenameFile(cardId: string, oldPath: string, newFileName: string): Promise<void> {
    try {
      const oldUri = vscode.Uri.file(path.join(this.workspaceRoot, oldPath));
      const dir = path.dirname(oldPath);
      const ext = path.extname(oldPath);
      const newBaseName = newFileName.includes('.') ? newFileName : newFileName + ext;
      const newPath = dir === '.' ? newBaseName : path.join(dir, newBaseName);
      const newUri = vscode.Uri.file(path.join(this.workspaceRoot, newPath));

      await vscode.workspace.fs.rename(oldUri, newUri);
      this.dataManager.updateCard(cardId, { filePath: newPath });
      this.panel.webview.postMessage({
        command: 'fileRenamed',
        cardId,
        oldPath,
        newPath,
      });
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`ファイル名の変更に失敗しました: ${errorMsg}`);
    }
  }

  private async reconcileFileRenames(before: CorkboardRootConfig, after: CorkboardRootConfig): Promise<void> {
    const beforeMap = this.buildCardPathMap(before);
    const afterMap = this.buildCardPathMap(after);
    const renames: Array<{ from: string; to: string }> = [];

    for (const [id, fromPath] of beforeMap) {
      const toPath = afterMap.get(id);
      if (toPath && toPath !== fromPath) {
        renames.push({ from: fromPath, to: toPath });
      }
    }

    for (const rename of renames) {
      await this.safeRenameFile(rename.from, rename.to);
    }
  }

  private buildCardPathMap(config: CorkboardRootConfig): Map<string, string> {
    const map = new Map<string, string>();
    for (const board of Object.values(config.boards)) {
      for (const card of board.cards) {
        map.set(card.id, card.filePath);
      }
    }
    return map;
  }

  private async safeRenameFile(fromPath: string, toPath: string): Promise<void> {
    if (fromPath === toPath) return;
    const fromUri = vscode.Uri.file(path.join(this.workspaceRoot, fromPath));
    const toUri = vscode.Uri.file(path.join(this.workspaceRoot, toPath));

    try {
      await vscode.workspace.fs.stat(fromUri);
    } catch {
      return;
    }

    try {
      await vscode.workspace.fs.stat(toUri);
      vscode.window.showWarningMessage(`ファイルの名前を元に戻せませんでした: ${toPath} が既に存在します。`);
      return;
    } catch {
      // target does not exist
    }

    try {
      await vscode.workspace.fs.rename(fromUri, toUri);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      vscode.window.showWarningMessage(`ファイル名の復元に失敗しました: ${errorMsg}`);
    }
  }

  /** ワークスペースファイルの変更・削除を監視 */
  private setupFileWatcher(): void {
    const glob = vscode.workspace.getConfiguration('corkboard').get<string>('fileGlob', '**/*.{md,txt}');
    const pattern = new vscode.RelativePattern(this.workspaceRoot, glob);
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    // ファイル変更時 → カードの概要を更新
    watcher.onDidChange(async (uri) => {
      const config = this.dataManager.getConfig();
      const filePath = path.relative(this.workspaceRoot, uri.fsPath);
      const card = config.cards.find(c => c.filePath === filePath);
      if (card) {
        const preview = await this.fileScanner.getFilePreview(filePath);
        this.panel.webview.postMessage({
          command: 'fileChanged',
          filePath,
          preview,
        });
      }
    }, null, this.disposables);

    // ファイル削除時 → Webviewに通知
    watcher.onDidDelete((uri) => {
      const filePath = path.relative(this.workspaceRoot, uri.fsPath);
      this.panel.webview.postMessage({
        command: 'fileDeleted',
        filePath,
      });
    }, null, this.disposables);

    this.disposables.push(watcher);
  }

  private dispose(): void {
    CorkboardPanel.currentPanel = undefined;
    this.dataManager.dispose();
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
