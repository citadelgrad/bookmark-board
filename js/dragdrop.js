/**
 * dragdrop.js — Native HTML5 drag-and-drop for Bookmark Board
 * Adds BookmarkBoard.DragDrop to the shared namespace.
 *
 * Supports:
 *   - Reordering bookmark cards within a collection
 *   - Moving bookmark cards between collections
 *   - Dropping open tab entries onto a collection to create a bookmark
 *
 * Data flow:
 *   dragstart → encode source data in dataTransfer
 *   dragover  → show visual drop target; compute insertion position
 *   drop      → decode data; call Store mutation; re-render
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.DragDrop = (function () {
  const Store = BookmarkBoard.Store;

  // ─── Drag state ────────────────────────────────────────────────────────────

  // Mirrors what we packed into dataTransfer so drop handlers can read it
  // synchronously without relying on getData() which is restricted in dragover.
  let _dragState = null;

  // The placeholder element shown in the grid while dragging
  let _placeholder = null;

  // Thin horizontal line shown between collections during collection drag
  let _collPlaceholder = null;

  // Thin horizontal line shown between spaces during space drag
  let _spacePlaceholder = null;

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Return the grid element for a collection id, or null.
   * @param {string} collectionId
   * @returns {HTMLElement|null}
   */
  function _gridFor(collectionId) {
    return document.querySelector(`.bookmark-grid[data-collection-id="${CSS.escape(collectionId)}"]`);
  }

  /**
   * Compute the insertion index for a drop within a grid.
   * Uses horizontal midpoint of each card to decide before/after.
   *
   * @param {HTMLElement} grid
   * @param {number} clientX
   * @param {number} clientY
   * @returns {number}
   */
  function _dropIndex(grid, clientX, clientY) {
    const cards = [...grid.querySelectorAll('.bookmark-card:not(.dragging):not(.drag-placeholder)')];
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const midY = rect.top + rect.height / 2;

      // Multi-row grid: compare by row first (Y), then column (X)
      if (clientY < rect.bottom) {
        // We are on this row or above it
        if (clientY < midY || clientX < midX) {
          return i;
        }
        // Past the midpoint of this card — insert after it if it's the
        // last card in the row (next card is on a new row) or just continue
        if (i + 1 < cards.length) {
          const nextRect = cards[i + 1].getBoundingClientRect();
          if (nextRect.top > rect.bottom - 4) {
            // Next card is on a new row — insert at end of this row
            return i + 1;
          }
        }
      }
    }
    return cards.length;
  }

  /**
   * Ensure a placeholder card exists and position it in the grid.
   * @param {HTMLElement} grid
   * @param {number} index  insertion index before which to show the placeholder
   */
  function _showPlaceholder(grid, index) {
    if (!_placeholder) {
      _placeholder = document.createElement('div');
      _placeholder.className = 'bookmark-card drag-placeholder';
    }

    const cards = [...grid.querySelectorAll('.bookmark-card:not(.dragging):not(.drag-placeholder)')];
    if (index >= cards.length) {
      grid.appendChild(_placeholder);
    } else {
      grid.insertBefore(_placeholder, cards[index]);
    }
  }

  /** Remove the placeholder from wherever it currently lives. */
  function _removePlaceholder() {
    if (_placeholder && _placeholder.parentNode) {
      _placeholder.parentNode.removeChild(_placeholder);
    }
    _placeholder = null;
  }

  /** Clear all drop-target highlights. */
  function _clearHighlights() {
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  }

  // ─── Collection drag helpers ──────────────────────────────────────────────

  /** Remove the collection drag placeholder line. */
  function _removeCollPlaceholder() {
    if (_collPlaceholder && _collPlaceholder.parentNode) {
      _collPlaceholder.parentNode.removeChild(_collPlaceholder);
    }
    _collPlaceholder = null;
  }

  /**
   * Compute insertion index among .collection elements based on vertical
   * cursor position. Returns 0..N where N = number of collections.
   */
  function _collectionDropIndex(container, clientY) {
    const collections = [...container.querySelectorAll('.collection[data-collection-id]:not(.dragging)')];
    for (let i = 0; i < collections.length; i++) {
      const rect = collections[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (clientY < midY) return i;
    }
    return collections.length;
  }

  /**
   * Show a thin horizontal placeholder line at the given insertion index.
   */
  function _showCollPlaceholder(container, index) {
    if (!_collPlaceholder) {
      _collPlaceholder = document.createElement('div');
      _collPlaceholder.className = 'collection-drag-placeholder';
    }

    const collections = [...container.querySelectorAll('.collection[data-collection-id]:not(.dragging)')];
    if (index >= collections.length) {
      container.appendChild(_collPlaceholder);
    } else {
      container.insertBefore(_collPlaceholder, collections[index]);
    }
  }

  /**
   * Attach dragstart / dragend handlers to a collection header to make the
   * entire collection draggable for reordering.
   */
  function _attachCollectionDrag(header, collectionId, spaceId) {
    header.draggable = true;

    header.addEventListener('dragstart', e => {
      _dragState = { type: 'collection', collectionId, spaceId };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-bb-collection-drag', collectionId);

      const section = header.closest('.collection');
      if (section) requestAnimationFrame(() => section.classList.add('dragging'));
    });

    header.addEventListener('dragend', () => {
      const section = header.closest('.collection');
      if (section) section.classList.remove('dragging');
      _dragState = null;
      _removeCollPlaceholder();
      _clearHighlights();
    });
  }

  /**
   * Attach dragover / drop handlers to the collections container to accept
   * collection reorder drops.
   */
  function _attachCollectionDropZone(container) {
    container.addEventListener('dragover', e => {
      if (!_dragState || _dragState.type !== 'collection') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const idx = _collectionDropIndex(container, e.clientY);
      _showCollPlaceholder(container, idx);
    });

    container.addEventListener('dragleave', e => {
      if (!container.contains(e.relatedTarget)) {
        _removeCollPlaceholder();
      }
    });

    container.addEventListener('drop', async e => {
      if (!_dragState || _dragState.type !== 'collection') return;
      e.preventDefault();
      _removeCollPlaceholder();

      const { collectionId, spaceId } = _dragState;
      const Render = BookmarkBoard.Render;

      // Build new ordered ID array from current DOM order (excluding the dragged one)
      const allSections = [...container.querySelectorAll('.collection[data-collection-id]')];
      const orderedIds = allSections
        .map(el => el.dataset.collectionId)
        .filter(id => id !== collectionId);

      // Insert at computed position
      const dropIdx = _collectionDropIndex(container, e.clientY);
      orderedIds.splice(dropIdx, 0, collectionId);

      await Store.reorderCollections(spaceId, orderedIds);
      if (Render) Render.renderCollections(Render.getActiveSpaceId());
    });
  }

  // ─── Space drag helpers ────────────────────────────────────────────────────

  /** Remove the space drag placeholder line. */
  function _removeSpacePlaceholder() {
    if (_spacePlaceholder && _spacePlaceholder.parentNode) {
      _spacePlaceholder.parentNode.removeChild(_spacePlaceholder);
    }
    _spacePlaceholder = null;
  }

  /**
   * Compute insertion index among .space-item elements based on vertical
   * cursor position. Returns 0..N where N = number of spaces.
   */
  function _spaceDropIndex(list, clientY) {
    const items = [...list.querySelectorAll('.space-item[data-space-id]:not(.dragging)')];
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (clientY < midY) return i;
    }
    return items.length;
  }

  /**
   * Show a thin horizontal placeholder line at the given insertion index.
   */
  function _showSpacePlaceholder(list, index) {
    if (!_spacePlaceholder) {
      _spacePlaceholder = document.createElement('div');
      _spacePlaceholder.className = 'space-drag-placeholder';
    }

    const items = [...list.querySelectorAll('.space-item[data-space-id]:not(.dragging)')];
    if (index >= items.length) {
      list.appendChild(_spacePlaceholder);
    } else {
      list.insertBefore(_spacePlaceholder, items[index]);
    }
  }

  /**
   * Attach dragstart / dragend handlers to a space item to make it draggable.
   */
  function _attachSpaceDrag(item) {
    item.draggable = true;

    item.addEventListener('dragstart', e => {
      const spaceId = item.dataset.spaceId;
      _dragState = { type: 'space', spaceId };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-bb-space-drag', spaceId);

      requestAnimationFrame(() => item.classList.add('dragging'));
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      _dragState = null;
      _removeSpacePlaceholder();
      _clearHighlights();
    });
  }

  /**
   * Attach dragover / drop handlers to the spaces list to accept
   * space reorder drops.
   */
  function _attachSpaceDropZone(list) {
    list.addEventListener('dragover', e => {
      if (!_dragState || _dragState.type !== 'space') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const idx = _spaceDropIndex(list, e.clientY);
      _showSpacePlaceholder(list, idx);
    });

    list.addEventListener('dragleave', e => {
      if (!list.contains(e.relatedTarget)) {
        _removeSpacePlaceholder();
      }
    });

    list.addEventListener('drop', async e => {
      if (!_dragState || _dragState.type !== 'space') return;
      e.preventDefault();
      _removeSpacePlaceholder();

      const { spaceId } = _dragState;
      const Render = BookmarkBoard.Render;

      // Build new ordered ID array excluding the dragged space
      const allItems = [...list.querySelectorAll('.space-item[data-space-id]')];
      const orderedIds = allItems
        .map(el => el.dataset.spaceId)
        .filter(id => id !== spaceId);

      // Insert at computed position
      const dropIdx = _spaceDropIndex(list, e.clientY);
      orderedIds.splice(dropIdx, 0, spaceId);

      await Store.reorderSpaces(orderedIds);
      if (Render) Render.renderSidebar();
    });
  }

  // ─── Bookmark card drag source ─────────────────────────────────────────────

  /**
   * Attach dragstart / dragend handlers to a single bookmark card.
   * render.js already sets draggable="true" on the card element.
   *
   * @param {HTMLElement} card
   */
  function _attachCardDrag(card) {
    card.addEventListener('dragstart', e => {
      const bookmarkId = card.dataset.bookmarkId;
      const collectionId = card.dataset.collectionId;

      _dragState = { type: 'bookmark', bookmarkId, collectionId };

      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-bb-bookmark-id', bookmarkId);
      e.dataTransfer.setData('application/x-bb-collection-id', collectionId);
      e.dataTransfer.setData('text/plain', bookmarkId);

      // Defer adding .dragging so the browser snapshot doesn't include it
      requestAnimationFrame(() => card.classList.add('dragging'));
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      _dragState = null;
      _removePlaceholder();
      _clearHighlights();
    });
  }

  // ─── Collection body drop target ───────────────────────────────────────────

  /**
   * Attach dragover / dragenter / dragleave / drop handlers to a grid element.
   * @param {HTMLElement} grid
   */
  function _attachGridDrop(grid) {
    const collectionId = grid.dataset.collectionId;

    grid.addEventListener('dragenter', e => {
      if (_dragState?.type === 'collection') return;
      if (!_isAcceptable(e)) return;
      e.preventDefault();
      grid.classList.add('drop-target');
    });

    grid.addEventListener('dragover', e => {
      if (_dragState?.type === 'collection') return;
      if (!_isAcceptable(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = _dragState && _dragState.type === 'bookmark' ? 'move' : 'copy';

      grid.classList.add('drop-target');

      if (_dragState && _dragState.type === 'bookmark') {
        const idx = _dropIndex(grid, e.clientX, e.clientY);
        _showPlaceholder(grid, idx);
      }
    });

    grid.addEventListener('dragleave', e => {
      // Only clear if we've left the grid entirely (not just moved to a child)
      if (!grid.contains(e.relatedTarget)) {
        grid.classList.remove('drop-target');
        _removePlaceholder();
      }
    });

    grid.addEventListener('drop', async e => {
      if (_dragState?.type === 'collection') return;
      e.preventDefault();
      grid.classList.remove('drop-target');

      // Read placeholder position before cleanup so same-grid reorders get the
      // correct insertion index when dragging left/up.
      let dropIdx = null;
      if (_dragState && _dragState.type === 'bookmark') {
        const cards = [...grid.querySelectorAll('.bookmark-card:not(.dragging):not(.drag-placeholder)')];
        dropIdx = cards.length;

        if (_placeholder && _placeholder.parentNode === grid) {
          const phIdx = [...grid.children].indexOf(_placeholder);
          // Count only real cards before the placeholder
          dropIdx = [...grid.children].slice(0, phIdx)
            .filter(el => el.classList.contains('bookmark-card') &&
                          !el.classList.contains('dragging') &&
                          !el.classList.contains('drag-placeholder'))
            .length;
        } else {
          // Fallback when placeholder is unavailable (e.g. very fast drop)
          dropIdx = _dropIndex(grid, e.clientX, e.clientY);
        }
      }

      _removePlaceholder();

      const Render = BookmarkBoard.Render;

      // ── Bookmark card dropped ──
      if (_dragState && _dragState.type === 'bookmark') {
        const { bookmarkId, collectionId: fromCollectionId } = _dragState;
        const insertAt = Number.isInteger(dropIdx) ? dropIdx : 0;

        if (fromCollectionId === collectionId) {
          // Same collection — reorder
          const col = Store.getCollections(Render.getActiveSpaceId())
            .find(c => c.id === collectionId);
          if (col) {
            const ids = col.bookmarks
              .slice()
              .sort((a, b) => a.order - b.order)
              .map(b => b.id)
              .filter(id => id !== bookmarkId);
            ids.splice(insertAt, 0, bookmarkId);
            await Store.reorderBookmarks(collectionId, ids);
          }
        } else {
          // Cross-collection move
          await Store.moveBookmark(fromCollectionId, collectionId, bookmarkId, insertAt);
        }

        if (Render) Render.renderCollections(Render.getActiveSpaceId());
        return;
      }

      // ── Tab entry dropped ──
      const tabUrl = e.dataTransfer.getData('application/x-tab-url') ||
                     e.dataTransfer.getData('text/uri-list') ||
                     e.dataTransfer.getData('text/plain');
      const tabTitle = e.dataTransfer.getData('application/x-tab-title') || tabUrl;

      if (tabUrl) {
        await Store.addBookmark(collectionId, { title: tabTitle, url: tabUrl });
        if (Render) Render.renderCollections(Render.getActiveSpaceId());
      }
    });
  }

  // ─── Collection header drop target ─────────────────────────────────────────

  /**
   * Allow dropping onto a collapsed collection header to add to the top.
   * @param {HTMLElement} header
   * @param {string} collectionId
   */
  function _attachHeaderDrop(header, collectionId) {
    header.addEventListener('dragenter', e => {
      if (_dragState?.type === 'collection') return;
      if (!_isAcceptable(e)) return;
      e.preventDefault();
      header.classList.add('drop-target');
    });

    header.addEventListener('dragover', e => {
      if (_dragState?.type === 'collection') return;
      if (!_isAcceptable(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      header.classList.add('drop-target');
    });

    header.addEventListener('dragleave', e => {
      if (!header.contains(e.relatedTarget)) {
        header.classList.remove('drop-target');
      }
    });

    header.addEventListener('drop', async e => {
      if (_dragState?.type === 'collection') return;
      e.preventDefault();
      header.classList.remove('drop-target');

      const Render = BookmarkBoard.Render;
      const tabUrl = e.dataTransfer.getData('application/x-tab-url') ||
                     e.dataTransfer.getData('text/uri-list') ||
                     e.dataTransfer.getData('text/plain');
      const tabTitle = e.dataTransfer.getData('application/x-tab-title') || tabUrl;

      if (tabUrl) {
        await Store.addBookmark(collectionId, { title: tabTitle, url: tabUrl });
        if (Render) Render.renderCollections(Render.getActiveSpaceId());
      } else if (_dragState && _dragState.type === 'bookmark') {
        const { bookmarkId, collectionId: fromCollectionId } = _dragState;
        await Store.moveBookmark(fromCollectionId, collectionId, bookmarkId, 0);
        if (Render) Render.renderCollections(Render.getActiveSpaceId());
      }
    });
  }

  // ─── Acceptability guard ───────────────────────────────────────────────────

  /**
   * Return true if this drag event carries data we can handle.
   * We accept:
   *   - Our own bookmark cards (_dragState set)
   *   - Tab items from the tabs sidebar (x-tab-url type)
   *   - Generic URI drops (text/uri-list)
   */
  function _isAcceptable(e) {
    if (_dragState) return true;
    const types = e.dataTransfer.types;
    return types.includes('application/x-tab-url') ||
           types.includes('text/uri-list');
  }

  // ─── Public: init ──────────────────────────────────────────────────────────

  /**
   * Set up drag and drop for all current bookmark cards and collection grids.
   * Call this after every render that produces new DOM elements.
   */
  function init() {
    // Attach drag sources to all bookmark cards
    document.querySelectorAll('.bookmark-card[data-bookmark-id]').forEach(card => {
      // Guard against double-attaching by checking a data flag
      if (card.dataset.ddInit) return;
      card.dataset.ddInit = '1';
      _attachCardDrag(card);
    });

    // Attach drop targets to all bookmark grids
    document.querySelectorAll('.bookmark-grid[data-collection-id]').forEach(grid => {
      if (grid.dataset.ddInit) return;
      grid.dataset.ddInit = '1';
      _attachGridDrop(grid);
    });

    // Attach drop targets to collection headers (for collapsed collections)
    // AND attach collection drag handles for reordering
    document.querySelectorAll('.collection-header').forEach(header => {
      const section = header.closest('[data-collection-id]');
      if (!section) return;
      if (header.dataset.ddInit) return;
      header.dataset.ddInit = '1';
      _attachHeaderDrop(header, section.dataset.collectionId);
    });

    // Collection reorder: attach drag source to each collection header
    const Render = BookmarkBoard.Render;
    const activeSpaceId = Render ? Render.getActiveSpaceId() : null;
    document.querySelectorAll('.collection[data-collection-id]').forEach(section => {
      if (section.dataset.ddCollInit) return;
      section.dataset.ddCollInit = '1';
      const header = section.querySelector('.collection-header');
      if (header && activeSpaceId) {
        _attachCollectionDrag(header, section.dataset.collectionId, activeSpaceId);
      }
    });

    // Collection reorder: attach drop zone to the collections container
    const collContainer = document.getElementById('collections-container');
    if (collContainer && !collContainer.dataset.ddCollInit) {
      collContainer.dataset.ddCollInit = '1';
      _attachCollectionDropZone(collContainer);
    }

    // Space reorder: attach drag source to each space item
    document.querySelectorAll('.space-item[data-space-id]').forEach(item => {
      if (item.dataset.ddSpaceInit) return;
      item.dataset.ddSpaceInit = '1';
      _attachSpaceDrag(item);
    });

    // Space reorder: attach drop zone to the spaces list
    const spacesList = document.getElementById('spaces-list');
    if (spacesList && !spacesList.dataset.ddSpaceInit) {
      spacesList.dataset.ddSpaceInit = '1';
      _attachSpaceDropZone(spacesList);
    }
  }

  return { init };
})();
