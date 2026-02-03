import * as vscode from 'vscode';
import * as path from 'path';
import { CorkboardDataManager } from './CorkboardDataManager';
import { FileScanner } from './FileScanner';
import { WebviewToExtensionMessage } from './types';
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
  }

  private async handleMessage(msg: WebviewToExtensionMessage): Promise<void> {
    switch (msg.command) {
      case 'openFile': {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;
        const uri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, msg.filePath));
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        break;
      }
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
      case 'setViewMode':
        this.dataManager.setViewMode(msg.mode);
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
    }
  }

  private async showFilePicker(): Promise<void> {
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
      for (const item of selected) {
        const card = this.dataManager.addCard(item.filePath);
        const preview = await this.fileScanner.getFilePreview(item.filePath);
        this.panel.webview.postMessage({
          command: 'cardAdded',
          card,
          preview,
        });
      }
    }
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
      <button id="btn-add-files" class="toolbar-btn" title="ファイルを追加">＋ ファイルを追加</button>
      <div class="toolbar-separator"></div>
      <button id="btn-grid" class="toolbar-btn mode-btn active" data-mode="grid" title="グリッドモード">グリッド</button>
      <button id="btn-freeform" class="toolbar-btn mode-btn" data-mode="freeform" title="フリーフォームモード">フリーフォーム</button>
    </div>
    <div class="toolbar-right">
      <button id="btn-commit" class="toolbar-btn hidden" title="現在の配置から順序を確定">順序を確定</button>
      <label class="toolbar-label" id="columns-control">
        カラム:
        <button id="btn-col-minus" class="toolbar-btn-small">−</button>
        <span id="col-count">4</span>
        <button id="btn-col-plus" class="toolbar-btn-small">＋</button>
      </label>
    </div>
  </div>
  <div id="corkboard-container"></div>
  <div id="empty-state" class="hidden">
    <p>カードがありません</p>
    <p>「＋ ファイルを追加」ボタンでファイルをカードとして追加できます</p>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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
