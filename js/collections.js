/**
 * collections.js — Collections and bookmark card renderer
 * A "collection" is a named group of bookmarks within a space.
 * Adds BookmarkBoard.collections to the global namespace.
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.collections = (function () {
  const { uid, faviconUrl } = BookmarkBoard.utils;
  const { load, save } = BookmarkBoard.storage;

  /** @type {HTMLElement|null} */
  let _container = null;

  /**
   * Get storage key for a given space.
   * @param {string} spaceId
   * @returns {string}
   */
  function storageKey(spaceId) {
    return `collections_${spaceId}`;
  }

  /**
   * Load and render collections for a space.
   * @param {HTMLElement} container
   * @param {string} spaceId
   */
  async function render(container, spaceId) {
    _container = container;
    container.textContent = '';

    const collections = await load(storageKey(spaceId), []);

    if (collections.length === 0) {
      container.appendChild(buildEmptyState());
      return;
    }

    for (const col of collections) {
      container.appendChild(renderCollection(col, spaceId));
    }
  }

  /**
   * Build a collection section element.
   * @param {{id: string, name: string, bookmarks: Array}} col
   * @param {string} spaceId
   * @returns {HTMLElement}
   */
  function renderCollection(col, spaceId) {
    const section = document.createElement('div');
    section.className = 'collection';
    section.dataset.colId = col.id;

    // Header
    const header = document.createElement('div');
    header.className = 'collection-header';

    const nameEl = document.createElement('span');
    nameEl.className = 'collection-name';
    nameEl.textContent = col.name;

    const count = document.createElement('span');
    count.className = 'collection-count';
    count.textContent = col.bookmarks.length;

    const toggle = document.createElement('button');
    toggle.className = 'collection-toggle';
    toggle.textContent = '⌄';
    toggle.title = 'Collapse';
    toggle.addEventListener('click', () => {
      section.classList.toggle('collapsed');
      toggle.textContent = section.classList.contains('collapsed') ? '›' : '⌄';
      toggle.title = section.classList.contains('collapsed') ? 'Expand' : 'Collapse';
    });

    header.appendChild(nameEl);
    header.appendChild(count);
    header.appendChild(toggle);

    // Body with bookmark grid
    const body = document.createElement('div');
    body.className = 'collection-body';

    const grid = document.createElement('div');
    grid.className = 'bookmark-grid';

    for (const bm of col.bookmarks) {
      grid.appendChild(renderBookmarkCard(bm));
    }

    body.appendChild(grid);
    section.appendChild(header);
    section.appendChild(body);

    return section;
  }

  /**
   * Build a single bookmark card element.
   * @param {{id: string, title: string, url: string}} bm
   * @returns {HTMLElement}
   */
  function renderBookmarkCard(bm) {
    const card = document.createElement('a');
    card.className = 'bookmark-card';
    card.href = bm.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.dataset.bmId = bm.id;
    card.draggable = true;

    const img = document.createElement('img');
    img.className = 'bookmark-favicon';
    img.alt = '';
    img.src = faviconUrl(bm.url, 32);
    img.onerror = () => { img.src = faviconUrl(bm.url, 32); };

    const titleEl = document.createElement('span');
    titleEl.className = 'bookmark-title';
    titleEl.textContent = bm.title || bm.url;

    const urlEl = document.createElement('span');
    urlEl.className = 'bookmark-url';
    try {
      urlEl.textContent = new URL(bm.url).hostname;
    } catch (_) {
      urlEl.textContent = bm.url;
    }

    card.appendChild(img);
    card.appendChild(titleEl);
    card.appendChild(urlEl);

    return card;
  }

  /**
   * Build the empty state element (no collections yet).
   * @returns {HTMLElement}
   */
  function buildEmptyState() {
    const el = document.createElement('div');
    el.className = 'empty-state';

    const icon = document.createElement('span');
    icon.className = 'empty-state-icon';
    icon.textContent = '\uD83D\uDCCB'; // 📋

    const msg = document.createElement('span');
    msg.textContent = 'No collections yet. Import bookmarks to get started.';

    el.appendChild(icon);
    el.appendChild(msg);
    return el;
  }

  /**
   * Add a new empty collection to a space.
   * @param {string} spaceId
   * @param {string} name
   */
  async function addCollection(spaceId, name) {
    const key = storageKey(spaceId);
    const cols = await load(key, []);
    cols.push({ id: uid('col'), name, bookmarks: [] });
    await save(key, cols);
  }

  /**
   * Import bookmarks from a Chrome BookmarkTreeNode folder into a space.
   * Each top-level folder becomes a collection; loose bookmarks go to "Bookmarks".
   * @param {string} spaceId
   * @param {chrome.bookmarks.BookmarkTreeNode} rootNode
   */
  async function importFromBookmarkBar(spaceId, rootNode) {
    const key = storageKey(spaceId);
    const cols = [];

    const loose = [];
    for (const child of rootNode.children ?? []) {
      if (child.url) {
        loose.push({ id: uid('bm'), title: child.title, url: child.url });
      } else {
        const bookmarks = [];
        BookmarkBoard.bookmarks.walk(child, {
          onBookmark: (bm) => bookmarks.push({ id: uid('bm'), title: bm.title, url: bm.url }),
        });
        if (bookmarks.length > 0) {
          cols.push({ id: uid('col'), name: child.title, bookmarks });
        }
      }
    }

    if (loose.length > 0) {
      cols.unshift({ id: uid('col'), name: 'Bookmarks', bookmarks: loose });
    }

    await save(key, cols);
  }

  return { render, addCollection, importFromBookmarkBar };
})();
