import { initMessageHandler } from './messageHandler';
import { initCorkboard, loadCorkboard, addCard } from './corkboard';

// VSCode API初期化
const vscodeApi = initMessageHandler();

// コルクボードUI初期化
initCorkboard();

// Extensionからのメッセージを受信
window.addEventListener('message', (event) => {
  const message = event.data;
  switch (message.command) {
    case 'loadCorkboard':
      loadCorkboard(message.data, message.filePreviews);
      break;
    case 'cardAdded':
      addCard(message.card, message.preview);
      break;
    case 'configReloaded':
      loadCorkboard(message.data, message.filePreviews);
      break;
    case 'fileChanged':
      // ファイル変更時はリロード（将来的に差分更新可能）
      break;
    case 'fileDeleted':
      // ファイル削除時の処理（将来実装）
      break;
  }
});
