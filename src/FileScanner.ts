import * as vscode from 'vscode';
import * as path from 'path';
import { FilePreview, FileContent } from './types';
import { extractFrontmatterSynopsis, getFirstLines } from './utils';

export class FileScanner {
  constructor(private workspaceRoot: string) {}

  /** 指定ファイルのプレビューを取得 */
  async getFilePreview(filePath: string): Promise<FilePreview> {
    const synopsisLines = vscode.workspace.getConfiguration('corkboard').get<number>('synopsisLines', 3);
    const fullPath = path.join(this.workspaceRoot, filePath);
    const uri = vscode.Uri.file(fullPath);
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(data).toString('utf-8');
      return {
        filePath,
        firstLines: getFirstLines(content, synopsisLines),
        frontmatterSynopsis: extractFrontmatterSynopsis(content),
      };
    } catch {
      return {
        filePath,
        firstLines: '（ファイルを読み込めません）',
        frontmatterSynopsis: null,
      };
    }
  }

  /** 複数ファイルのプレビューを取得 */
  async getFilePreviews(filePaths: string[]): Promise<FilePreview[]> {
    return Promise.all(filePaths.map(fp => this.getFilePreview(fp)));
  }

  /** ワークスペース内の対象ファイルを一覧取得 */
  async listEligibleFiles(): Promise<string[]> {
    const glob = vscode.workspace.getConfiguration('corkboard').get<string>('fileGlob', '**/*.{md,txt}');
    const uris = await vscode.workspace.findFiles(glob, '**/node_modules/**', 500);
    return uris.map(uri => path.relative(this.workspaceRoot, uri.fsPath));
  }

  /** ファイルの全文を取得 */
  async getFileContent(filePath: string): Promise<FileContent> {
    const fullPath = path.join(this.workspaceRoot, filePath);
    const uri = vscode.Uri.file(fullPath);
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      return {
        filePath,
        content: Buffer.from(data).toString('utf-8'),
      };
    } catch {
      return {
        filePath,
        content: '（ファイルを読み込めません）',
      };
    }
  }

  /** 複数ファイルの全文を取得 */
  async getFileContents(filePaths: string[]): Promise<FileContent[]> {
    return Promise.all(filePaths.map(fp => this.getFileContent(fp)));
  }

  /** 指定フォルダ内の対象ファイルを一覧取得 */
  async listEligibleFilesInFolder(folderRelPath: string): Promise<string[]> {
    const fileGlob = vscode.workspace.getConfiguration('corkboard').get<string>('fileGlob', '**/*.{md,txt}');
    const scopedGlob = folderRelPath ? `${folderRelPath}/${fileGlob}` : fileGlob;
    const uris = await vscode.workspace.findFiles(scopedGlob, '**/node_modules/**', 500);
    return uris.map(uri => path.relative(this.workspaceRoot, uri.fsPath));
  }
}
