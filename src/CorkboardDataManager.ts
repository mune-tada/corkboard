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
  private undoStack: CorkboardRootConfig[] = [];
  private redoStack: CorkboardRootConfig[] = [];
  private isRestoring = false;
  private readonly maxHistory = 100;

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

    this.resetHistory();
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

  getRootConfigSnapshot(): CorkboardRootConfig {
    if (!this.rootConfig) {
      throw new Error('Config not loaded. Call load() first.');
    }
    return this.cloneRootConfig(this.rootConfig);
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
    if (this.rootConfig.activeBoard === name) {
      return this.rootConfig.boards[name];
    }
    this.pushHistory();
    this.rootConfig.activeBoard = name;
    this.config = this.rootConfig.boards[name];
    this.scheduleSave();
    return this.config;
  }

  /** 新規ボード作成 */
  createBoard(name: string): void {
    if (!this.rootConfig) throw new Error('Not loaded');
    if (this.rootConfig.boards[name]) return;
    this.pushHistory();
    this.rootConfig.boards[name] = createDefaultBoardConfig();
    this.scheduleSave();
  }

  /** ボードリネーム */
  renameBoard(oldName: string, newName: string): void {
    if (!this.rootConfig) throw new Error('Not loaded');
    const board = this.rootConfig.boards[oldName];
    if (!board || this.rootConfig.boards[newName]) return;
    this.pushHistory();
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
    if (!this.rootConfig.boards[name]) return;
    this.pushHistory();
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
    this.pushHistory();
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
    const hasCard = config.cards.some(c => c.id === cardId);
    if (!hasCard) return;
    this.pushHistory();
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
      const entries = Object.entries(changes) as [keyof CardData, CardData[keyof CardData]][];
      const hasChange = entries.some(([key, value]) => card[key] !== value);
      if (!hasChange) return;
      this.pushHistory();
      Object.assign(card, changes);
      this.scheduleSave();
    }
  }

  /** リンクを追加 */
  addLink(link: LinkData): void {
    const config = this.getConfig();
    this.pushHistory();
    config.links.push(link);
    this.scheduleSave();
  }

  /** リンクを更新 */
  updateLink(linkId: string, changes: Partial<LinkData>): void {
    const config = this.getConfig();
    const link = config.links.find(l => l.id === linkId);
    if (link) {
      const entries = Object.entries(changes) as [keyof LinkData, LinkData[keyof LinkData]][];
      const hasChange = entries.some(([key, value]) => link[key] !== value);
      if (!hasChange) return;
      this.pushHistory();
      Object.assign(link, changes);
      this.scheduleSave();
    }
  }

  /** リンクを削除 */
  removeLink(linkId: string): void {
    const config = this.getConfig();
    const hasLink = config.links.some(l => l.id === linkId);
    if (!hasLink) return;
    this.pushHistory();
    config.links = config.links.filter(l => l.id !== linkId);
    this.scheduleSave();
  }

  /** カード順序の並べ替え */
  reorderCards(cardIds: string[]): void {
    const config = this.getConfig();
    this.pushHistory();
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
    if (config.viewMode === mode) return;
    this.pushHistory();
    config.viewMode = mode;
    this.scheduleSave();
  }

  /** グリッドカラム数変更 */
  setGridColumns(columns: number): void {
    const config = this.getConfig();
    if (config.gridColumns === columns) return;
    this.pushHistory();
    config.gridColumns = columns;
    this.scheduleSave();
  }

  /** カード高さ変更 */
  setCardHeight(height: 'small' | 'medium' | 'large'): void {
    const config = this.getConfig();
    if (config.cardHeight === height) return;
    this.pushHistory();
    config.cardHeight = height;
    this.scheduleSave();
  }

  async undo(): Promise<boolean> {
    if (!this.rootConfig || this.undoStack.length === 0) return false;
    const current = this.cloneRootConfig(this.rootConfig);
    const snapshot = this.undoStack.pop()!;
    this.redoStack.push(current);
    this.isRestoring = true;
    this.applySnapshot(snapshot);
    this.isRestoring = false;
    await this.saveImmediate();
    return true;
  }

  async redo(): Promise<boolean> {
    if (!this.rootConfig || this.redoStack.length === 0) return false;
    const current = this.cloneRootConfig(this.rootConfig);
    const snapshot = this.redoStack.pop()!;
    this.undoStack.push(current);
    this.isRestoring = true;
    this.applySnapshot(snapshot);
    this.isRestoring = false;
    await this.saveImmediate();
    return true;
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
        const text = Buffer.from(data).toString('utf-8');
        if (this.rootConfig) {
          const current = JSON.stringify(this.rootConfig, null, 2);
          if (text === current) {
            return;
          }
        }
        const raw = JSON.parse(text);
        if (raw.version === 2) {
          this.rootConfig = raw as CorkboardRootConfig;
          this.config = this.rootConfig.boards[this.rootConfig.activeBoard];
        }
        this.resetHistory();
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

  private resetHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private pushHistory(): void {
    if (!this.rootConfig || this.isRestoring) return;
    this.undoStack.push(this.cloneRootConfig(this.rootConfig));
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  private cloneRootConfig(source: CorkboardRootConfig): CorkboardRootConfig {
    return JSON.parse(JSON.stringify(source)) as CorkboardRootConfig;
  }

  private applySnapshot(snapshot: CorkboardRootConfig): void {
    this.rootConfig = snapshot;
    const active = this.rootConfig.activeBoard;
    let board = this.rootConfig.boards[active];
    if (!board) {
      const fallback = Object.keys(this.rootConfig.boards)[0];
      this.rootConfig.activeBoard = fallback || 'メインボード';
      board = this.rootConfig.boards[this.rootConfig.activeBoard];
      if (!board) {
        board = createDefaultBoardConfig();
        this.rootConfig.boards[this.rootConfig.activeBoard] = board;
      }
    }
    this.config = board;
  }
}
