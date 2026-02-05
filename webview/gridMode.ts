import Sortable from 'sortablejs';
import { sendReorderCards } from './messageHandler';

let sortableInstance: Sortable | null = null;

/** グリッドモードを初期化 */
export function initGridMode(viewport: HTMLElement, content: HTMLElement): void {
  destroyGridMode();

  viewport.classList.add('grid-mode');
  viewport.classList.remove('freeform-mode');

  // カードの絶対位置をクリア
  const cards = content.querySelectorAll<HTMLElement>('.card');
  cards.forEach(card => {
    card.style.position = '';
    card.style.left = '';
    card.style.top = '';
    card.style.zIndex = '';
  });

  sortableInstance = Sortable.create(content, {
    animation: 200,
    ghostClass: 'card-ghost',
    chosenClass: 'card-chosen',
    dragClass: 'card-drag',
    handle: '.card-header',
    onEnd: () => {
      const cardIds: string[] = [];
      content.querySelectorAll<HTMLElement>('.card').forEach(el => {
        if (el.dataset.id) {
          cardIds.push(el.dataset.id);
        }
      });
      sendReorderCards(cardIds);

      // カード番号を更新
      updateCardNumbers(content);
    },
  });
}

/** カード番号を更新 */
export function updateCardNumbers(container: HTMLElement): void {
  const cards = container.querySelectorAll<HTMLElement>('.card');
  cards.forEach((card, index) => {
    const numberEl = card.querySelector('.card-number');
    if (numberEl) {
      numberEl.textContent = String(index + 1);
    }
  });
}

/** グリッドモードを破棄 */
export function destroyGridMode(): void {
  if (sortableInstance) {
    sortableInstance.destroy();
    sortableInstance = null;
  }
}
