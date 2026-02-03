import { initMessageHandler } from './messageHandler';
import { initCorkboard, loadCorkboard, addCard, handleFileChanged, handleFileDeleted, handleFileRenamed } from './corkboard';

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
      handleFileChanged(message.filePath, message.preview);
      break;
    case 'fileDeleted':
      handleFileDeleted(message.filePath);
      break;
    case 'fileRenamed':
      handleFileRenamed(message.cardId, message.oldPath, message.newPath);
      break;
  }
});
