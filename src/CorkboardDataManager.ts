import * as vscode from 'vscode';
import * as path from 'path';
import { CorkboardConfig, CardData, createDefaultConfig } from './types';
import { generateId } from './utils';

export class CorkboardDataManager {
  private config: CorkboardConfig | null = null;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private configWatcher: vscode.FileSystemWatcher | null = null;
  private onConfigChanged: (() => void) | null = null;

  constructor(private workspaceRoot: string) {}

  /** 設定変更コールバックを登録 */
  setOnConfigChanged(callback: () => void): void {
    this.onConfigChanged = callback;
  }

  /** .corkboard.json のパス */
  private get configPath(): string {
    return path.join(this.workspaceRoot, '.corkboard.json');
  }

  /** 設定を読み込み（なければデフォルト作成） */
  async load(): Promise<CorkboardConfig> {
    const uri = vscode.Uri.file(this.configPath);
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      this.config = JSON.parse(Buffer.from(data).toString('utf-8'));
    } catch {
      this.config = createDefaultConfig();
      await this.saveImmediate();
    }
    this.startWatching();
    return this.config!;
  }

  /** 現在の設定を返す */
  getConfig(): CorkboardConfig {
    if (!this.config) {
      throw new Error('Config not loaded. Call load() first.');
    }
    return this.config;
  }

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
    // orderを再割り当て
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
  setViewMode(mode: 'grid' | 'freeform'): void {
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
    if (!this.config) return;
    const uri = vscode.Uri.file(this.configPath);
    const content = JSON.stringify(this.config, null, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
  }

  /** .corkboard.jsonの外部変更を監視 */
  private startWatching(): void {
    if (this.configWatcher) return;
    const pattern = new vscode.RelativePattern(this.workspaceRoot, '.corkboard.json');
    this.configWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.configWatcher.onDidChange(async () => {
      // 外部変更を検知してリロード
      const uri = vscode.Uri.file(this.configPath);
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        this.config = JSON.parse(Buffer.from(data).toString('utf-8'));
        this.onConfigChanged?.();
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
