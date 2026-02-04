import * as vscode from 'vscode';
import * as path from 'path';
import { CorkboardConfig, CorkboardRootConfig, CorkboardConfigV1, CardData, LinkData, createDefaultConfig, createDefaultBoardConfig } from './types';
import { generateId } from './utils';

export class CorkboardDataManager {
  private rootConfig: CorkboardRootConfig | null = null;
  private config: CorkboardConfig | null = null;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private configWatcher: vscode.FileSystemWatcher | null = null;
  private onConfigChangedCallback: (() => void) | null = null;

  constructor(private workspaceRoot: string) {}

  /** 設定変更コールバックを登録 */
  setOnConfigChanged(callback: () => void): void {
    this.onConfigChangedCallback = callback;
  }

  /** .corkboard.json のパス */
  private get configPath(): string {
    return path.join(this.workspaceRoot, '.corkboard.json');
  }

  /** v1 → v2 マイグレーション */
  private migrateV1toV2(v1: CorkboardConfigV1): CorkboardRootConfig {
    const { version: _, ...boardConfig } = v1;
    const mergedConfig: CorkboardConfig = {
      ...createDefaultBoardConfig(),
      ...boardConfig,
    };
    return {
      version: 2,
      activeBoard: 'メインボード',
      boards: {
        'メインボード': mergedConfig,
      },
    };
  }

  /** 設定を読み込み（なければデフォルト作成） */
  async load(): Promise<CorkboardConfig> {
    const uri = vscode.Uri.file(this.configPath);
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      const raw = JSON.parse(Buffer.from(data).toString('utf-8'));

      if (raw.version === 1) {
        this.rootConfig = this.migrateV1toV2(raw as CorkboardConfigV1);
        await this.saveImmediate();
      } else if (raw.version === 2) {
        this.rootConfig = raw as CorkboardRootConfig;
      } else {
        this.rootConfig = createDefaultConfig();
        await this.saveImmediate();
      }
    } catch {
      this.rootConfig = createDefaultConfig();
      await this.saveImmediate();
    }

    this.config = this.rootConfig.boards[this.rootConfig.activeBoard];
    if (!this.config) {
      const boardNames = Object.keys(this.rootConfig.boards);
      this.rootConfig.activeBoard = boardNames[0] || 'メインボード';
      this.config = this.rootConfig.boards[this.rootConfig.activeBoard];
      if (!this.config) {
        this.config = createDefaultBoardConfig();
        this.rootConfig.boards[this.rootConfig.activeBoard] = this.config;
      }
    }

    let updated = false;
    Object.values(this.rootConfig.boards).forEach(board => {
      if (this.ensureBoardDefaults(board)) {
        updated = true;
      }
    });
    if (updated) {
      await this.saveImmediate();
    }

    this.startWatching();
    return this.config;
  }

  /** 現在のボード設定を返す */
  getConfig(): CorkboardConfig {
    if (!this.config) {
      throw new Error('Config not loaded. Call load() first.');
    }
    return this.config;
  }

  // ---- ボード管理 ----

  /** ボード名一覧を返す */
  getBoardNames(): string[] {
    if (!this.rootConfig) return [];
    return Object.keys(this.rootConfig.boards);
  }

  /** アクティブボード名を返す */
  getActiveBoard(): string {
    return this.rootConfig?.activeBoard || 'メインボード';
  }

  /** ボードを切替 */
  switchBoard(name: string): CorkboardConfig {
    if (!this.rootConfig) throw new Error('Not loaded');
    if (!this.rootConfig.boards[name]) throw new Error(`Board not found: ${name}`);
    this.rootConfig.activeBoard = name;
    this.config = this.rootConfig.boards[name];
    this.scheduleSave();
    return this.config;
  }

  /** 新規ボード作成 */
  createBoard(name: string): void {
    if (!this.rootConfig) throw new Error('Not loaded');
    if (this.rootConfig.boards[name]) return;
    this.rootConfig.boards[name] = createDefaultBoardConfig();
    this.scheduleSave();
  }

  /** ボードリネーム */
  renameBoard(oldName: string, newName: string): void {
    if (!this.rootConfig) throw new Error('Not loaded');
    const board = this.rootConfig.boards[oldName];
    if (!board || this.rootConfig.boards[newName]) return;
    this.rootConfig.boards[newName] = board;
    delete this.rootConfig.boards[oldName];
    if (this.rootConfig.activeBoard === oldName) {
      this.rootConfig.activeBoard = newName;
    }
    this.scheduleSave();
  }

  /** ボード削除 */
  deleteBoard(name: string): void {
    if (!this.rootConfig) throw new Error('Not loaded');
    if (Object.keys(this.rootConfig.boards).length <= 1) return;
    delete this.rootConfig.boards[name];
    if (this.rootConfig.activeBoard === name) {
      this.rootConfig.activeBoard = Object.keys(this.rootConfig.boards)[0];
      this.config = this.rootConfig.boards[this.rootConfig.activeBoard];
    }
    this.scheduleSave();
  }

  // ---- カード操作 ----

  /** カードを追加 */
  addCard(filePath: string): CardData {
    const config = this.getConfig();
    const existing = config.cards.find(c => c.filePath === filePath);
    if (existing) {
      return existing;
    }
    const card: CardData = {
      id: generateId(),
      filePath,
      synopsis: null,
      label: null,
      status: null,
      order: config.cards.length,
      position: null,
    };
    config.cards.push(card);
    this.scheduleSave();
    return card;
  }

  /** カードを削除 */
  removeCard(cardId: string): void {
    const config = this.getConfig();
    config.cards = config.cards.filter(c => c.id !== cardId);
    config.links = config.links.filter(l => l.fromId !== cardId && l.toId !== cardId);
    config.cards
      .sort((a, b) => a.order - b.order)
      .forEach((c, i) => { c.order = i; });
    this.scheduleSave();
  }

  /** カードを更新 */
  updateCard(cardId: string, changes: Partial<CardData>): void {
    const config = this.getConfig();
    const card = config.cards.find(c => c.id === cardId);
    if (card) {
      Object.assign(card, changes);
      this.scheduleSave();
    }
  }

  /** リンクを追加 */
  addLink(link: LinkData): void {
    const config = this.getConfig();
    config.links.push(link);
    this.scheduleSave();
  }

  /** リンクを更新 */
  updateLink(linkId: string, changes: Partial<LinkData>): void {
    const config = this.getConfig();
    const link = config.links.find(l => l.id === linkId);
    if (link) {
      Object.assign(link, changes);
      this.scheduleSave();
    }
  }

  /** リンクを削除 */
  removeLink(linkId: string): void {
    const config = this.getConfig();
    config.links = config.links.filter(l => l.id !== linkId);
    this.scheduleSave();
  }

  /** カード順序の並べ替え */
  reorderCards(cardIds: string[]): void {
    const config = this.getConfig();
    cardIds.forEach((id, index) => {
      const card = config.cards.find(c => c.id === id);
      if (card) {
        card.order = index;
      }
    });
    this.scheduleSave();
  }

  /** 表示モード変更 */
  setViewMode(mode: 'grid' | 'freeform' | 'text'): void {
    const config = this.getConfig();
    config.viewMode = mode;
    this.scheduleSave();
  }

  /** グリッドカラム数変更 */
  setGridColumns(columns: number): void {
    const config = this.getConfig();
    config.gridColumns = columns;
    this.scheduleSave();
  }

  /** カード高さ変更 */
  setCardHeight(height: 'small' | 'medium' | 'large'): void {
    const config = this.getConfig();
    config.cardHeight = height;
    this.scheduleSave();
  }

  /** ボード設定の不足項目を補完 */
  private ensureBoardDefaults(board: CorkboardConfig): boolean {
    let updated = false;
    const height = (board as { cardHeight?: string }).cardHeight;
    if (height !== 'small' && height !== 'medium' && height !== 'large') {
      board.cardHeight = 'medium';
      updated = true;
    }
    if (!Array.isArray((board as { links?: LinkData[] }).links)) {
      board.links = [];
      updated = true;
    }
    return updated;
  }

  // ---- 保存・監視 ----

  /** デバウンス保存（500ms） */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveImmediate();
    }, 500);
  }

  /** 即座に保存 */
  async saveImmediate(): Promise<void> {
    if (!this.rootConfig) return;
    const uri = vscode.Uri.file(this.configPath);
    const content = JSON.stringify(this.rootConfig, null, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
  }

  /** .corkboard.jsonの外部変更を監視 */
  private startWatching(): void {
    if (this.configWatcher) return;
    const pattern = new vscode.RelativePattern(this.workspaceRoot, '.corkboard.json');
    this.configWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.configWatcher.onDidChange(async () => {
      const uri = vscode.Uri.file(this.configPath);
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        const raw = JSON.parse(Buffer.from(data).toString('utf-8'));
        if (raw.version === 2) {
          this.rootConfig = raw as CorkboardRootConfig;
          this.config = this.rootConfig.boards[this.rootConfig.activeBoard];
        }
        this.onConfigChangedCallback?.();
      } catch {
        // ignore parse errors
      }
    });
  }

  /** リソース解放 */
  dispose(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.configWatcher?.dispose();
  }
}
