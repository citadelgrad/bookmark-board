/**
 * import.js — Bookmark bar importer
 * Reads the Chrome bookmark bar and populates the active space with collections.
 * Adds BookmarkBoard.Import to the shared namespace.
 *
 * Security note: All user-controlled strings from chrome.bookmarks (node.title,
 * node.url) are assigned via textContent — never innerHTML. The _esc() helper
 * is used only for the few places where a string must appear inside an HTML
 * attribute (e.g., data-url on anchor elements).
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.Import = (function () {
  const Store = BookmarkBoard.Store;
  const { uid } = BookmarkBoard.utils;

  // ─── Internal helpers ──────────────────────────────────────────────────────

  /** HTML-escape for attribute values only. */
  function _esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Recursively walk a bookmark tree node and return a flat list of
   * { collectionName, bookmarks[] } objects.
   *
   * @param {BookmarkTreeNode} node   - the node to walk
   * @param {string}           prefix - parent folder names joined with ' > '
   * @returns {{ collectionName: string, bookmarks: Array<{title,url}> }[]}
   */
  function _flattenTree(node, prefix) {
    const results = [];

    if (!node.children) return results; // leaf bookmark — caller handles

    const name = prefix ? prefix + ' > ' + node.title : node.title;
    const directBookmarks = [];

    node.children.forEach(child => {
      if (child.url) {
        // Direct bookmark inside this folder
        directBookmarks.push({ title: child.title || child.url, url: child.url });
      } else if (child.children) {
        // Sub-folder → recurse, accumulate as separate collections
        results.push(..._flattenTree(child, name));
      }
    });

    if (directBookmarks.length > 0) {
      results.unshift({ collectionName: name, bookmarks: directBookmarks });
    }

    return results;
  }

  /**
   * Core import logic — operates directly on Store._state so we can bulk-write
   * and flush once, rather than triggering storage.set() per bookmark.
   *
   * @param {string}            spaceId - target space
   * @param {BookmarkTreeNode}  barNode - result of chrome.bookmarks.getSubTree('1')[0]
   * @returns {{ collectionCount: number, bookmarkCount: number }}
   */
  function _runImport(spaceId, barNode) {
    const state = Store._state;
    const space = state.spaces.find(s => s.id === spaceId);
    if (!space) return { collectionCount: 0, bookmarkCount: 0 };

    const children = barNode.children || [];

    // Separate loose bookmarks (directly in bar root) from folders
    const looseBookmarks = children.filter(n => n.url);
    const folders = children.filter(n => !n.url && n.children);

    // Build a Set of existing URLs per collection for de-dup
    const existingUrls = new Map(); // collectionId → Set<url>
    state.collections
      .filter(c => c.spaceId === spaceId)
      .forEach(c => {
        existingUrls.set(c.id, new Set(c.bookmarks.map(b => b.url)));
      });

    let totalBookmarks = 0;
    let totalCollections = 0;

    // ── Loose bookmarks → 'Unsorted' collection ───────────────────────────────
    if (looseBookmarks.length > 0) {
      const unsortedName = 'Unsorted';
      let unsortedCol = state.collections.find(
        c => c.spaceId === spaceId && c.name === unsortedName
      );

      if (!unsortedCol) {
        const spaceCollections = state.collections.filter(c => c.spaceId === spaceId);
        unsortedCol = {
          id: uid('col'),
          spaceId,
          name: unsortedName,
          tags: [],
          order: spaceCollections.length,
          collapsed: false,
          bookmarks: [],
        };
        state.collections.push(unsortedCol);
        space.collectionIds.push(unsortedCol.id);
        existingUrls.set(unsortedCol.id, new Set());
        totalCollections++;
      }

      const seen = existingUrls.get(unsortedCol.id);
      looseBookmarks.forEach(node => {
        if (seen.has(node.url)) return; // skip duplicate
        unsortedCol.bookmarks.push({
          id: uid('bm'),
          title: node.title || node.url,
          url: node.url,
          order: unsortedCol.bookmarks.length,
        });
        seen.add(node.url);
        totalBookmarks++;
      });
    }

    // ── Folders → one collection each (flattened, nested prefixed) ────────────
    folders.forEach(folder => {
      const entries = _flattenTree(folder, '');

      entries.forEach(({ collectionName, bookmarks }) => {
        // Find existing collection with same name in this space, or create one
        let col = state.collections.find(
          c => c.spaceId === spaceId && c.name === collectionName
        );

        if (!col) {
          const spaceCollections = state.collections.filter(c => c.spaceId === spaceId);
          col = {
            id: uid('col'),
            spaceId,
            name: collectionName,
            tags: [],
            order: spaceCollections.length,
            collapsed: false,
            bookmarks: [],
          };
          state.collections.push(col);
          space.collectionIds.push(col.id);
          existingUrls.set(col.id, new Set(col.bookmarks.map(b => b.url)));
          totalCollections++;
        }

        const seen = existingUrls.get(col.id);
        bookmarks.forEach(({ title, url }) => {
          if (seen.has(url)) return; // skip duplicate
          col.bookmarks.push({
            id: uid('bm'),
            title,
            url,
            order: col.bookmarks.length,
          });
          seen.add(url);
          totalBookmarks++;
        });
      });
    });

    return { collectionCount: totalCollections, bookmarkCount: totalBookmarks };
  }

  // ─── Modal UI ──────────────────────────────────────────────────────────────

  /** Count bookmarks recursively inside a node. */
  function _countBookmarks(node) {
    if (node.url) return 1;
    return (node.children || []).reduce((n, c) => n + _countBookmarks(c), 0);
  }

  /**
   * Build and display the import modal overlay.
   * On open, loads the bookmark bar and presents a folder checklist.
   * Resolves when the user closes the modal (after import or on cancel).
   *
   * @param {string}  spaceId - target space for import
   * @param {boolean} auto    - true if triggered automatically on first run
   * @returns {Promise<void>}
   */
  function showImportModal(spaceId, auto) {
    return new Promise(resolve => {
      // Prevent duplicate modals
      const existing = document.getElementById('import-modal');
      if (existing) { existing.remove(); }

      // ── Overlay ────────────────────────────────────────────────────────────
      const overlay = document.createElement('div');
      overlay.id = 'import-modal';
      overlay.className = 'import-modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Import bookmarks');

      // ── Dialog box ─────────────────────────────────────────────────────────
      const dialog = document.createElement('div');
      dialog.className = 'import-modal-dialog';

      // Header
      const header = document.createElement('div');
      header.className = 'import-modal-header';

      const title = document.createElement('h2');
      title.className = 'import-modal-title';
      title.textContent = 'Import Bookmarks';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'import-modal-close';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.textContent = '\u00D7'; // ×

      header.append(title, closeBtn);

      // Body
      const body = document.createElement('div');
      body.className = 'import-modal-body';

      const desc = document.createElement('p');
      desc.className = 'import-modal-desc';
      if (auto) {
        desc.textContent =
          'No bookmarks found. Import your Chrome bookmark bar to get started.';
      } else {
        desc.textContent =
          'Import bookmarks from your Chrome bookmark bar. Existing bookmarks will not be duplicated.';
      }

      const status = document.createElement('div');
      status.className = 'import-modal-status';
      status.setAttribute('aria-live', 'polite');

      body.append(desc, status);

      // Footer
      const footer = document.createElement('div');
      footer.className = 'import-modal-footer';

      const importBtn = document.createElement('button');
      importBtn.className = 'import-modal-btn import-modal-btn--primary';
      importBtn.textContent = 'Import Selected';
      importBtn.disabled = true; // enabled after folder list loads

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'import-modal-btn import-modal-btn--secondary';
      cancelBtn.textContent = 'Cancel';

      footer.append(importBtn, cancelBtn);
      dialog.append(header, body, footer);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      // ── Event handlers ─────────────────────────────────────────────────────

      function _close() {
        overlay.remove();
        resolve();
      }

      closeBtn.addEventListener('click', _close);
      cancelBtn.addEventListener('click', _close);

      overlay.addEventListener('click', e => {
        if (e.target === overlay) _close();
      });

      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') _close();
      });

      // ── State shared between load / import ─────────────────────────────────
      let _barNode = null; // the raw bookmark bar node

      /**
       * Build (or rebuild) the folder checklist inside the modal body.
       * Called on first open and after "Import Again".
       */
      async function _loadFolderList() {
        importBtn.disabled = true;
        importBtn.textContent = 'Import Selected';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.disabled = false;
        status.textContent = 'Loading bookmark bar\u2026';

        // Remove any previous folder list
        const prev = body.querySelector('.import-folder-list');
        if (prev) prev.remove();
        const prevToggle = body.querySelector('.import-folder-toggle');
        if (prevToggle) prevToggle.remove();

        try {
          const [barNode] = await chrome.bookmarks.getSubTree('1');
          _barNode = barNode;

          const children = barNode.children || [];
          const looseBookmarks = children.filter(n => n.url);
          const folders = children.filter(n => !n.url && n.children);

          if (looseBookmarks.length === 0 && folders.length === 0) {
            status.textContent = 'Your bookmark bar is empty.';
            return;
          }

          status.textContent = '';

          // Build entries: [ { label, count, index|'loose' } ]
          const entries = [];

          if (looseBookmarks.length > 0) {
            entries.push({
              key: 'loose',
              label: 'Unsorted',
              count: looseBookmarks.length,
            });
          }

          folders.forEach((folder, i) => {
            entries.push({
              key: i,
              label: folder.title || '(untitled)',
              count: _countBookmarks(folder),
            });
          });

          // Select All / Deselect All toggle
          const toggleLink = document.createElement('button');
          toggleLink.className = 'import-folder-toggle';
          toggleLink.textContent = 'Deselect All';
          body.insertBefore(toggleLink, status);

          // Scrollable folder list
          const list = document.createElement('div');
          list.className = 'import-folder-list';

          entries.forEach(({ key, label, count }) => {
            const item = document.createElement('label');
            item.className = 'import-folder-item';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true;
            cb.dataset.key = key;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'import-folder-item-name';
            nameSpan.textContent = label;

            const countSpan = document.createElement('span');
            countSpan.className = 'import-folder-item-count';
            countSpan.textContent = `${count} bookmark${count !== 1 ? 's' : ''}`;

            item.append(cb, nameSpan, countSpan);
            list.appendChild(item);
          });

          body.insertBefore(list, status);

          // Toggle behaviour
          toggleLink.addEventListener('click', () => {
            const boxes = list.querySelectorAll('input[type="checkbox"]');
            const allChecked = Array.from(boxes).every(c => c.checked);
            boxes.forEach(c => { c.checked = !allChecked; });
            toggleLink.textContent = allChecked ? 'Select All' : 'Deselect All';
          });

          // Keep toggle label in sync when individual checkboxes change
          list.addEventListener('change', () => {
            const boxes = list.querySelectorAll('input[type="checkbox"]');
            const allChecked = Array.from(boxes).every(c => c.checked);
            toggleLink.textContent = allChecked ? 'Deselect All' : 'Select All';
          });

          importBtn.disabled = false;
          importBtn.focus();
        } catch (err) {
          status.textContent =
            'Could not access bookmarks. Make sure the extension has bookmark permission.';
          console.error('[BookmarkBoard] Import error:', err);
        }
      }

      // ── Import click ────────────────────────────────────────────────────────
      importBtn.addEventListener('click', async () => {
        if (!_barNode) return;

        const list = body.querySelector('.import-folder-list');
        const checked = new Set();
        if (list) {
          list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            if (cb.checked) checked.add(cb.dataset.key);
          });
        }

        if (checked.size === 0) {
          status.textContent = 'Select at least one folder to import.';
          return;
        }

        importBtn.disabled = true;
        cancelBtn.disabled = true;
        status.textContent = 'Importing\u2026';

        try {
          const children = _barNode.children || [];
          const looseBookmarks = children.filter(n => n.url);
          const folders = children.filter(n => !n.url && n.children);

          // Build a filtered clone of barNode with only selected children
          const filteredChildren = [];

          if (checked.has('loose')) {
            filteredChildren.push(...looseBookmarks);
          }

          folders.forEach((folder, i) => {
            if (checked.has(String(i))) {
              filteredChildren.push(folder);
            }
          });

          const filteredBar = Object.assign({}, _barNode, {
            children: filteredChildren,
          });

          const { collectionCount, bookmarkCount } = _runImport(spaceId, filteredBar);
          await Store._save();

          Store._state.settings.hasImported = true;
          await Store._save();

          // Summary
          status.textContent =
            `Done! Added ${bookmarkCount} bookmark${bookmarkCount !== 1 ? 's' : ''} ` +
            `across ${collectionCount} new collection${collectionCount !== 1 ? 's' : ''}.`;

          importBtn.textContent = 'Import Again';
          importBtn.disabled = false;
          cancelBtn.textContent = 'Close';
          cancelBtn.disabled = false;

          // Re-render the UI with fresh data
          const { Render } = BookmarkBoard;
          if (Render && Render.renderAll) {
            Render.renderAll(spaceId);
          }

          // "Import Again" re-shows the picker
          importBtn.onclick = () => _loadFolderList();
        } catch (err) {
          status.textContent =
            'Could not access bookmarks. Make sure the extension has bookmark permission.';
          importBtn.disabled = false;
          cancelBtn.disabled = false;
          console.error('[BookmarkBoard] Import error:', err);
        }
      });

      // ── Kick off initial load ───────────────────────────────────────────────
      _loadFolderList();
    });
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Main import function. Opens the import modal and returns after the user
   * dismisses it.
   *
   * @param {string}  spaceId  - target space id
   * @param {boolean} [auto]   - set true when triggered automatically on first run
   */
  async function importBookmarkBar(spaceId, auto) {
    await showImportModal(spaceId, !!auto);
  }

  /**
   * Check first-run flag and trigger auto-import if needed.
   * Called from newtab.js after init() + renderAll().
   *
   * @param {string} activeSpaceId
   */
  async function maybeAutoImport(activeSpaceId) {
    const settings = Store._state.settings || {};
    if (settings.hasImported) return;

    // Also skip if the space already has bookmarks (imported via a different path)
    const collections = Store.getCollections(activeSpaceId);
    const hasBookmarks = collections.some(c => c.bookmarks && c.bookmarks.length > 0);
    if (hasBookmarks) {
      Store._state.settings.hasImported = true;
      await Store._save();
      return;
    }

    await showImportModal(activeSpaceId, true);
    Store._state.settings.hasImported = true;
    await Store._save();
  }

  return {
    importBookmarkBar,
    maybeAutoImport,
    showImportModal,
  };
})();
