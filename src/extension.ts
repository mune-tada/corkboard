import * as vscode from 'vscode';
import * as path from 'path';
import { CorkboardPanel } from './CorkboardPanel';

export function activate(context: vscode.ExtensionContext) {
  // コルクボードを開くコマンド
  const openCommand = vscode.commands.registerCommand('corkboard.open', () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('ワークスペースフォルダを開いてください。');
      return;
    }
    CorkboardPanel.createOrShow(context.extensionUri, workspaceFolder.uri.fsPath);
  });

  // エクスプローラーの右クリックからカードを追加
  const addFileCommand = vscode.commands.registerCommand('corkboard.addCurrentFile', async (uri: vscode.Uri) => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('ワークスペースフォルダを開いてください。');
      return;
    }

    // コルクボードが開いていなければ開く
    if (!CorkboardPanel.currentPanel) {
      CorkboardPanel.createOrShow(context.extensionUri, workspaceFolder.uri.fsPath);
      // パネル初期化を少し待つ
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const filePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
    await CorkboardPanel.addFileToBoard(filePath);
  });

  context.subscriptions.push(openCommand, addFileCommand);
}

export function deactivate() {}
