/**
 * drag.js — Drag-and-drop support for bookmark cards
 * Adds BookmarkBoard.drag to the global namespace.
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.drag = (function () {
  /** @type {string|null} ID of the bookmark card being dragged */
  let _draggedId = null;

  /**
   * Attach drag-and-drop listeners to the collections container.
   * Supports reordering bookmark cards within and between collections.
   * @param {HTMLElement} container - The .collections-container element
   */
  function init(container) {
    container.addEventListener('dragstart', onDragStart);
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('dragleave', onDragLeave);
    container.addEventListener('drop', onDrop);
    container.addEventListener('dragend', onDragEnd);
  }

  function onDragStart(e) {
    const card = e.target.closest('.bookmark-card');
    if (!card) return;
    _draggedId = card.dataset.bmId;
    e.dataTransfer.effectAllowed = 'move';
    // Slight delay so the ghost image renders before the card dims
    setTimeout(() => card.classList.add('dragging'), 0);
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const target = e.target.closest('.bookmark-card, .collection-body');
    if (!target) return;

    // Highlight drop targets
    const col = e.target.closest('.collection');
    if (col) col.classList.add('drop-target');
  }

  function onDragLeave(e) {
    const col = e.target.closest('.collection');
    if (col && !col.contains(e.relatedTarget)) {
      col.classList.remove('drop-target');
    }
  }

  function onDrop(e) {
    e.preventDefault();

    // Clear all drop-target highlights
    document.querySelectorAll('.collection.drop-target').forEach((el) => {
      el.classList.remove('drop-target');
    });

    const sourceCard = document.querySelector(`.bookmark-card[data-bm-id="${_draggedId}"]`);
    if (!sourceCard) return;

    const targetCard = e.target.closest('.bookmark-card');
    const targetBody = e.target.closest('.collection-body');

    if (!targetBody) return;

    const grid = targetBody.querySelector('.bookmark-grid');
    if (!grid) return;

    if (targetCard && targetCard !== sourceCard) {
      // Insert before the target card
      grid.insertBefore(sourceCard, targetCard);
    } else if (!targetCard) {
      // Dropped on empty area of collection body — append
      grid.appendChild(sourceCard);
    }

    // TODO: persist new order to storage
  }

  function onDragEnd(e) {
    const card = e.target.closest('.bookmark-card');
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('.collection.drop-target').forEach((el) => {
      el.classList.remove('drop-target');
    });
    _draggedId = null;
  }

  return { init };
})();
