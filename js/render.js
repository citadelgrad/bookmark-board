/**
 * render.js — UI renderer
 * Reads from BookmarkBoard.Store and updates the DOM.
 * Adds BookmarkBoard.Render to the shared namespace.
 *
 * Security note: All user-supplied strings (space names, collection names,
 * bookmark titles/URLs, tags) are passed through _esc() before being placed
 * into innerHTML. _esc() HTML-encodes &, <, >, and " so no unsanitised
 * string ever reaches the parser.  Static structural HTML (class names,
 * data-* attributes whose values come from our own uid() generator, and
 * hard-coded emoji strings) does not go through _esc() because it is not
 * user-controlled.
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.Render = (function () {
  const { faviconUrl, debounce } = BookmarkBoard.utils;
  const Store = BookmarkBoard.Store;

  // ─── State ─────────────────────────────────────────────────────────────────

  let _activeSpaceId = null;
  let _activeTagFilter = null;
  let _searchQuery = '';

  // ─── DOM helpers ───────────────────────────────────────────────────────────

  const $ = id => document.getElementById(id);

  /** HTML-escape a value so it is safe to splice into innerHTML. */
  function _esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _safeDomain(url) {
    try { return new URL(url).hostname; } catch (_) { return url || ''; }
  }

  // ─── Sidebar: Spaces ───────────────────────────────────────────────────────

  function renderSidebar() {
    const list = $('spaces-list');
    if (!list) return;

    const spaces = Store.getSpaces();
    list.innerHTML = '';

    if (spaces.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.style.padding = '24px 16px';
      const icon = document.createElement('span');
      icon.className = 'empty-state-icon';
      icon.textContent = '\u{1F4C2}'; // 📂
      const msg = document.createElement('span');
      msg.textContent = 'No spaces yet';
      empty.append(icon, msg);
      list.appendChild(empty);
      return;
    }

    spaces.forEach(space => {
      const item = document.createElement('div');
      item.className = 'space-item' + (space.id === _activeSpaceId ? ' active' : '');
      item.dataset.spaceId = space.id;

      const icon = document.createElement('span');
      icon.className = 'space-icon';
      icon.textContent = '\u{1F4C1}'; // 📁

      const name = document.createElement('span');
      name.className = 'space-name';
      name.textContent = space.name; // textContent — safe, no escaping needed

      const menuBtn = document.createElement('button');
      menuBtn.className = 'space-menu-btn btn-icon';
      menuBtn.dataset.spaceId = space.id;
      menuBtn.title = 'Space options';
      menuBtn.textContent = '\u22EF'; // ⋯

      item.append(icon, name, menuBtn);
      list.appendChild(item);
    });
  }

  // ─── Tag bar ───────────────────────────────────────────────────────────────

  function renderTagBar() {
    const bar = $('tag-bar');
    if (!bar) return;

    const tags = Store.getTags();
    bar.innerHTML = '';

    if (tags.length === 0) {
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'flex';

    const label = document.createElement('span');
    label.className = 'tag-bar-label';
    label.textContent = 'Filter:';
    bar.appendChild(label);

    tags.forEach(tag => {
      const chip = document.createElement('button');
      chip.className = 'tag-chip' + (tag === _activeTagFilter ? ' active' : '');
      chip.dataset.tag = tag;
      chip.textContent = tag; // textContent — safe
      bar.appendChild(chip);
    });

    if (_activeTagFilter) {
      const clear = document.createElement('button');
      clear.className = 'tag-chip tag-chip-clear';
      clear.id = 'tag-clear';
      clear.textContent = '\u2715 Clear'; // ✕ Clear
      bar.appendChild(clear);
    }
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  function renderSearch() {
    const wrapper = $('search-wrapper');
    if (!wrapper || wrapper.dataset.init) return;
    wrapper.dataset.init = '1';

    const input = wrapper.querySelector('#search-input');
    if (!input) return;

    input.addEventListener('input', debounce(e => {
      _searchQuery = e.target.value.trim().toLowerCase();
      renderCollections(_activeSpaceId);
    }, 300));
  }

  // ─── Collections ───────────────────────────────────────────────────────────

  function renderCollections(spaceId) {
    _activeSpaceId = spaceId;
    const container = $('collections-container');
    if (!container) return;

    container.innerHTML = '';

    // Toolbar row
    const toolbar = document.createElement('div');
    toolbar.className = 'collections-toolbar';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-add-collection';
    addBtn.id = 'btn-add-collection';
    addBtn.textContent = '+ Add Collection';
    toolbar.appendChild(addBtn);
    container.appendChild(toolbar);

    if (!spaceId) return;

    let collections = Store.getCollections(spaceId);

    if (_activeTagFilter) {
      collections = collections.filter(c => Array.isArray(c.tags) && c.tags.includes(_activeTagFilter));
    }

    if (collections.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const icon = document.createElement('span');
      icon.className = 'empty-state-icon';
      icon.textContent = '\u{1F4CB}'; // 📋
      const msg = document.createElement('span');
      msg.textContent = 'Import your bookmarks to get started, or click \u201C+ Add Collection\u201D.';
      const importHint = document.createElement('button');
      importHint.className = 'btn-add-collection';
      importHint.style.marginTop = '8px';
      importHint.textContent = '\u{1F4E5} Import Bookmarks';
      importHint.addEventListener('click', () => {
        const btn = document.getElementById('btn-import');
        if (btn) btn.click();
      });
      empty.append(icon, msg, importHint);
      container.appendChild(empty);
      return;
    }

    collections.forEach(col => container.appendChild(_buildCollectionEl(col)));
  }

  function _buildCollectionEl(collection) {
    const section = document.createElement('div');
    section.className = 'collection' + (collection.collapsed ? ' collapsed' : '');
    section.dataset.collectionId = collection.id;

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'collection-header';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'collection-toggle';
    toggleBtn.dataset.collectionId = collection.id;
    toggleBtn.title = 'Toggle';
    toggleBtn.textContent = collection.collapsed ? '\u25B6' : '\u25BC'; // ▶ / ▼

    const nameEl = document.createElement('span');
    nameEl.className = 'collection-name';
    nameEl.dataset.collectionId = collection.id;
    nameEl.textContent = collection.name; // textContent — safe

    const countEl = document.createElement('span');
    countEl.className = 'collection-count';
    countEl.textContent = String((collection.bookmarks || []).length);

    const tagsEl = document.createElement('div');
    tagsEl.className = 'collection-tags';
    (collection.tags || []).forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'collection-tag-chip';
      chip.textContent = tag; // textContent — safe
      tagsEl.appendChild(chip);
    });

    const menuBtn = document.createElement('button');
    menuBtn.className = 'collection-menu-btn btn-icon';
    menuBtn.dataset.collectionId = collection.id;
    menuBtn.title = 'Collection options';
    menuBtn.textContent = '\u22EF'; // ⋯

    header.append(toggleBtn, nameEl, countEl, tagsEl, menuBtn);
    section.appendChild(header);

    // ── Body ──
    const body = document.createElement('div');
    body.className = 'collection-body';

    const grid = document.createElement('div');
    grid.className = 'bookmark-grid';
    grid.dataset.collectionId = collection.id;

    let bookmarks = [...(collection.bookmarks || [])].sort((a, b) => a.order - b.order);

    if (_searchQuery) {
      bookmarks = bookmarks.filter(b =>
        (b.title || '').toLowerCase().includes(_searchQuery) ||
        (b.url || '').toLowerCase().includes(_searchQuery)
      );
    }

    if (bookmarks.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'bookmark-card-empty';
      placeholder.textContent = _searchQuery
        ? 'No bookmarks match your search.'
        : 'Drop bookmarks here or drag from the tabs sidebar.';
      grid.appendChild(placeholder);
    } else {
      bookmarks.forEach(bm => grid.appendChild(_buildBookmarkCard(bm, collection.id)));
    }

    body.appendChild(grid);
    section.appendChild(body);
    return section;
  }

  // Deterministic pastel color from a string
  function _domainColor(domain) {
    let h = 0;
    for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) & 0xfffff;
    return `hsl(${h % 360}, 55%, 50%)`;
  }

  function _buildBookmarkCard(bookmark, collectionId) {
    const card = document.createElement('div');
    card.className = 'bookmark-card';
    card.draggable = true;
    card.dataset.bmId = bookmark.id;        // used by drag.js querySelector
    card.dataset.bookmarkId = bookmark.id;  // used by click/remove handlers
    card.dataset.collectionId = collectionId;

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'bookmark-remove';
    removeBtn.dataset.bookmarkId = bookmark.id;
    removeBtn.dataset.collectionId = collectionId;
    removeBtn.title = 'Remove';
    removeBtn.textContent = '\u2715'; // ✕

    // Favicon with letter-avatar fallback
    const domain = _safeDomain(bookmark.url);
    const letter = (domain || '?')[0].toUpperCase();

    const img = document.createElement('img');
    img.className = 'bookmark-favicon';
    img.loading = 'lazy';
    img.alt = '';
    img.src = faviconUrl(bookmark.url, 32);
    img.onerror = function () {
      this.onerror = null;
      // Replace broken img with a letter-avatar span
      const fallback = document.createElement('span');
      fallback.className = 'favicon-fallback';
      fallback.style.background = _domainColor(domain);
      fallback.textContent = letter;
      this.replaceWith(fallback);
    };

    // Title
    const titleEl = document.createElement('span');
    titleEl.className = 'bookmark-title';
    titleEl.dataset.bookmarkId = bookmark.id;
    titleEl.textContent = bookmark.title || domain; // textContent — safe

    // URL hint
    const urlEl = document.createElement('span');
    urlEl.className = 'bookmark-url';
    urlEl.textContent = domain; // textContent — safe

    // Right-click context menu
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      _dismissMenu();
      _showBookmarkMenu(bookmark, collectionId, e.clientX, e.clientY);
    });

    card.append(removeBtn, img, titleEl, urlEl);
    return card;
  }

  // ─── Event Delegation ──────────────────────────────────────────────────────

  function _attachSidebarEvents() {
    const sidebar = document.getElementById('sidebar-left');
    if (!sidebar || sidebar.dataset.events) return;
    sidebar.dataset.events = '1';

    sidebar.addEventListener('click', async e => {
      const menuBtn = e.target.closest('.space-menu-btn');
      if (menuBtn) {
        e.stopPropagation();
        _showSpaceMenu(menuBtn.dataset.spaceId, menuBtn);
        return;
      }

      if (e.target.id === 'btn-add-space') {
        const name = prompt('Space name:');
        if (name && name.trim()) {
          const space = await Store.addSpace(name.trim());
          _activeSpaceId = space.id;
          renderSidebar();
          renderTagBar();
          renderCollections(_activeSpaceId);
        }
        return;
      }

      const spaceItem = e.target.closest('.space-item');
      if (spaceItem && spaceItem.dataset.spaceId) {
        _activeSpaceId = spaceItem.dataset.spaceId;
        renderSidebar();
        renderTagBar();
        renderCollections(_activeSpaceId);
      }
    });
  }

  function _attachMainEvents() {
    const tagBar = $('tag-bar');
    if (tagBar && !tagBar.dataset.events) {
      tagBar.dataset.events = '1';
      tagBar.addEventListener('click', e => {
        if (e.target.id === 'tag-clear') {
          _activeTagFilter = null;
        } else if (e.target.dataset.tag) {
          const clicked = e.target.dataset.tag;
          _activeTagFilter = clicked === _activeTagFilter ? null : clicked;
        }
        renderTagBar();
        renderCollections(_activeSpaceId);
      });
    }

    const main = document.getElementById('main-area');
    if (!main || main.dataset.events) return;
    main.dataset.events = '1';

    main.addEventListener('click', async e => {
      // Add collection
      if (e.target.id === 'btn-add-collection') {
        const name = prompt('Collection name:');
        if (name && name.trim()) {
          await Store.addCollection(_activeSpaceId, name.trim());
          renderCollections(_activeSpaceId);
          renderTagBar();
        }
        return;
      }

      // Toggle collapse
      const toggle = e.target.closest('.collection-toggle');
      if (toggle && toggle.dataset.collectionId) {
        await Store.toggleCollapse(toggle.dataset.collectionId);
        renderCollections(_activeSpaceId);
        return;
      }

      // Collection 3-dot menu
      const collMenu = e.target.closest('.collection-menu-btn');
      if (collMenu && collMenu.dataset.collectionId) {
        e.stopPropagation();
        _showCollectionMenu(collMenu.dataset.collectionId, collMenu);
        return;
      }

      // Remove bookmark
      const removeBtn = e.target.closest('.bookmark-remove');
      if (removeBtn) {
        e.stopPropagation();
        const { bookmarkId, collectionId } = removeBtn.dataset;
        if (confirm('Remove this bookmark?')) {
          await Store.removeBookmark(collectionId, bookmarkId);
          renderCollections(_activeSpaceId);
        }
        return;
      }

      // Open bookmark in new tab
      const card = e.target.closest('.bookmark-card');
      if (card && card.dataset.bookmarkId && !e.target.closest('.bookmark-remove')) {
        const collection = Store.getCollections(_activeSpaceId)
          .find(c => c.id === card.dataset.collectionId);
        if (!collection) return;
        const bm = collection.bookmarks.find(b => b.id === card.dataset.bookmarkId);
        if (bm) chrome.tabs.create({ url: bm.url });
      }
    });

    // Inline rename on double-click of collection name
    main.addEventListener('dblclick', async e => {
      const nameEl = e.target.closest('.collection-name');
      if (!nameEl || !nameEl.dataset.collectionId) return;

      const id = nameEl.dataset.collectionId;
      const current = nameEl.textContent.trim();

      const input = document.createElement('input');
      input.className = 'collection-name-input';
      input.value = current;
      nameEl.replaceWith(input);
      input.focus();
      input.select();

      const commit = async () => {
        const val = input.value.trim();
        if (val && val !== current) await Store.renameCollection(id, val);
        renderCollections(_activeSpaceId);
      };

      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') renderCollections(_activeSpaceId);
      });
    });
  }

  // ─── Context menus ─────────────────────────────────────────────────────────

  function _showSpaceMenu(spaceId, anchor) {
    _dismissMenu();
    _buildMenu([
      {
        label: '\u270F\uFE0F Rename',
        action: async () => {
          const space = Store.getSpaces().find(s => s.id === spaceId);
          const name = prompt('Rename space:', space ? space.name : '');
          if (name && name.trim()) {
            await Store.renameSpace(spaceId, name.trim());
            renderSidebar();
          }
        },
      },
      {
        label: '\u{1F5D1}\uFE0F Delete',
        action: async () => {
          if (confirm('Delete this space and all its collections?')) {
            await Store.removeSpace(spaceId);
            const spaces = Store.getSpaces();
            _activeSpaceId = spaces.length ? spaces[0].id : null;
            renderSidebar();
            renderTagBar();
            renderCollections(_activeSpaceId);
          }
        },
      },
    ], anchor);
  }

  function _showCollectionMenu(collectionId, anchor) {
    _dismissMenu();
    _buildMenu([
      {
        label: '\u270F\uFE0F Rename',
        action: async () => {
          const col = Store.getCollections(_activeSpaceId).find(c => c.id === collectionId);
          const name = prompt('Rename collection:', col ? col.name : '');
          if (name && name.trim()) {
            await Store.renameCollection(collectionId, name.trim());
            renderCollections(_activeSpaceId);
          }
        },
      },
      {
        label: '\u{1F3F7}\uFE0F Manage tags',
        action: async () => {
          const col = Store.getCollections(_activeSpaceId).find(c => c.id === collectionId);
          const current = (col && col.tags || []).join(', ');
          const input = prompt('Tags (comma-separated):', current);
          if (input !== null) {
            const tags = input.split(',').map(t => t.trim()).filter(Boolean);
            for (const t of tags) await Store.addTag(t);
            await Store.setCollectionTags(collectionId, tags);
            renderTagBar();
            renderCollections(_activeSpaceId);
          }
        },
      },
      {
        label: '\u{1F5C2}\uFE0F Open all tabs',
        action: () => {
          const col = Store.getCollections(_activeSpaceId).find(c => c.id === collectionId);
          if (col) col.bookmarks.forEach(b => chrome.tabs.create({ url: b.url }));
        },
      },
      {
        label: '\u{1F4E6} Move to Space \u25B8',
        action: () => {
          _showMoveToSpaceSubmenu(collectionId, anchor);
        },
      },
      {
        label: '\u{1F5D1}\uFE0F Delete',
        action: async () => {
          if (confirm('Delete this collection and all its bookmarks?')) {
            await Store.removeCollection(collectionId);
            renderCollections(_activeSpaceId);
            renderTagBar();
          }
        },
      },
    ], anchor);
  }

  function _showMoveToSpaceSubmenu(collectionId, anchor) {
    _dismissMenu();
    const spaces = Store.getSpaces().filter(s => s.id !== _activeSpaceId);

    if (spaces.length === 0) {
      _buildMenu([{
        label: 'No other spaces',
        action: () => {},
      }], anchor);
      return;
    }

    _buildMenu(
      spaces.map(space => ({
        label: '\u{1F4C1} ' + space.name,
        action: async () => {
          await Store.moveCollection(collectionId, space.id);
          renderCollections(_activeSpaceId);
          renderSidebar();
        },
      })),
      anchor
    );
  }

  function _showBookmarkMenu(bookmark, collectionId, clientX, clientY) {
    const domain = _safeDomain(bookmark.url);
    _buildMenu([
      {
        label: '\u270F\uFE0F Edit title',
        action: () => {
          // Find the title element and turn it into an inline input
          const card = document.querySelector(`.bookmark-card[data-bookmark-id="${bookmark.id}"]`);
          if (!card) return;
          const titleEl = card.querySelector('.bookmark-title');
          if (!titleEl) return;
          const current = titleEl.textContent;
          const input = document.createElement('input');
          input.className = 'bookmark-title-input';
          input.value = current;
          titleEl.replaceWith(input);
          input.focus();
          input.select();
          const commit = async () => {
            const val = input.value.trim() || domain;
            bookmark.title = val;
            await Store._save();
            renderCollections(_activeSpaceId);
          };
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
            if (ev.key === 'Escape') renderCollections(_activeSpaceId);
          });
        },
      },
      {
        label: '\u{1F4CB} Copy URL',
        action: () => navigator.clipboard.writeText(bookmark.url).catch(() => {}),
      },
      {
        label: '\u{1F5D7}\uFE0F Open in new tab',
        action: () => chrome.tabs.create({ url: bookmark.url }),
      },
      {
        label: '\u{1F5BC}\uFE0F Open in new window',
        action: () => chrome.windows.create({ url: bookmark.url }),
      },
      {
        label: '\u{1F5D1}\uFE0F Delete',
        action: async () => {
          await Store.removeBookmark(collectionId, bookmark.id);
          renderCollections(_activeSpaceId);
        },
      },
    ], null, { x: clientX, y: clientY });
  }

  function _buildMenu(items, anchor, pos) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = '_bb-context-menu';

    items.forEach(({ label, action }) => {
      const btn = document.createElement('button');
      btn.className = 'context-menu-item';
      btn.textContent = label; // textContent — labels are hard-coded strings above
      btn.addEventListener('click', () => { _dismissMenu(); action(); });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    if (pos) {
      _positionMenuAt(menu, pos.x, pos.y);
    } else {
      _positionMenu(menu, anchor);
    }
    return menu;
  }

  function _positionMenuAt(menu, x, y) {
    menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + 'px';
    // Reposition after layout (height is known now)
    requestAnimationFrame(() => {
      menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + 'px';
    });
    const dismiss = e => {
      if (!menu.contains(e.target)) {
        _dismissMenu();
        document.removeEventListener('click', dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener('click', dismiss, true), 0);
  }

  function _positionMenu(menu, anchor) {
    const rect = anchor.getBoundingClientRect();
    menu.style.top = rect.bottom + 4 + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';

    const dismiss = e => {
      if (!menu.contains(e.target)) {
        _dismissMenu();
        document.removeEventListener('click', dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener('click', dismiss, true), 0);
  }

  function _dismissMenu() {
    const existing = document.getElementById('_bb-context-menu');
    if (existing) existing.remove();
  }

  // ─── renderAll ─────────────────────────────────────────────────────────────

  function renderAll(activeSpaceId) {
    if (activeSpaceId != null) _activeSpaceId = activeSpaceId;
    renderSidebar();
    renderTagBar();
    renderSearch();
    renderCollections(_activeSpaceId);
    _attachSidebarEvents();
    _attachMainEvents();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  return {
    renderAll,
    renderSidebar,
    renderCollections,
    renderTagBar,
    renderSearch,
    getActiveSpaceId: () => _activeSpaceId,
  };
})();
