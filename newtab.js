/**
 * newtab.js — Entry point
 * Boots Bookmark Board after all modules are loaded.
 */

(async function () {
  const { Store, Render, Import, Backup, Tabs, DragDrop, AI, ScheduledBackup } = BookmarkBoard;

  // ─── Loading skeleton ───────────────────────────────────────────────────────
  const container = document.getElementById('collections-container');
  if (container) {
    for (let i = 0; i < 3; i++) {
      const sk = document.createElement('div');
      sk.className = 'skeleton skeleton-collection';
      container.appendChild(sk);
    }
  }

  // Boot the data store (loads from chrome.storage.local, seeds if first run)
  await Store.init();

  // Determine the initial active space
  const spaces = Store.getSpaces();
  const activeSpaceId = spaces.length ? spaces[0].id : null;

  // ─── Dark mode — apply saved preference before first render ────────────────
  const settings = Store._state.settings || {};
  if (settings.theme === 'dark') document.body.classList.add('dark');

  // Render the full UI (clears skeleton)
  Render.renderAll(activeSpaceId);

  // ─── Sidebar collapse ──────────────────────────────────────────────────────
  const sidebarToggle = document.getElementById('btn-sidebar-toggle');
  const sidebarLeft = document.getElementById('sidebar-left');
  if (sidebarToggle && sidebarLeft) {
    const COLLAPSED_KEY = 'bb_sidebar_collapsed';
    chrome.storage.local.get(COLLAPSED_KEY).then(result => {
      if (result[COLLAPSED_KEY]) {
        document.getElementById('app').classList.add('sidebar-collapsed');
      }
    });

    sidebarToggle.addEventListener('click', () => {
      const app = document.getElementById('app');
      const collapsed = app.classList.toggle('sidebar-collapsed');
      chrome.storage.local.set({ [COLLAPSED_KEY]: collapsed });
    });
  }

  // ─── Dark mode toggle ───────────────────────────────────────────────────────
  const themeBtn = document.getElementById('btn-theme-toggle');
  if (themeBtn) {
    function _updateThemeIcon() {
      themeBtn.textContent = document.body.classList.contains('dark') ? '\u263C' : '\u263D'; // ☼ / ☽
      themeBtn.title = document.body.classList.contains('dark') ? 'Switch to light mode' : 'Switch to dark mode';
    }
    _updateThemeIcon();

    themeBtn.addEventListener('click', async () => {
      const isDark = document.body.classList.toggle('dark');
      Store._state.settings = Store._state.settings || {};
      Store._state.settings.theme = isDark ? 'dark' : 'light';
      await Store._save();
      _updateThemeIcon();
    });
  }

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    // Ignore when user is already typing in an input/textarea
    const tag = document.activeElement && document.activeElement.tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA';

    if (e.key === '/' && !isTyping) {
      e.preventDefault();
      const search = document.getElementById('search-input');
      if (search) search.focus();
      return;
    }

    if (e.key === 'Escape') {
      // Close any open context menu
      const menu = document.getElementById('_bb-context-menu');
      if (menu) { menu.remove(); return; }

      // Close any open modal overlay
      const modal = document.querySelector('.import-modal-overlay, .ai-modal-overlay');
      if (modal) {
        const closeBtn = modal.querySelector('button[class$="-close"]');
        if (closeBtn) closeBtn.click();
        else modal.remove();
        return;
      }

      // Clear search
      const search = document.getElementById('search-input');
      if (search && search.value) {
        search.value = '';
        search.dispatchEvent(new Event('input'));
      }
    }
  });

  // ─── Drag & Drop ────────────────────────────────────────────────────────────
  if (DragDrop) {
    DragDrop.init();
    const collectionsEl = document.getElementById('collections-container');
    if (collectionsEl) {
      const observer = new MutationObserver(() => DragDrop.init());
      observer.observe(collectionsEl, { childList: true, subtree: true });
    }
  }

  // ─── Open-tabs sidebar ──────────────────────────────────────────────────────
  const tabsListEl = document.getElementById('tabs-list');
  if (tabsListEl && Tabs) {
    await Tabs.loadTabs(tabsListEl);
    Tabs.setupListeners(tabsListEl);
  }

  // ─── First-run auto-import ──────────────────────────────────────────────────
  if (activeSpaceId && Import) {
    await Import.maybeAutoImport(activeSpaceId);
  }

  // ─── Import button ──────────────────────────────────────────────────────────
  const importBtn = document.getElementById('btn-import');
  if (importBtn && Import && activeSpaceId) {
    importBtn.addEventListener('click', () => {
      Import.importBookmarkBar(activeSpaceId, false);
    });
  }

  // ─── Export / Restore buttons ───────────────────────────────────────────────
  if (Backup) {
    const exportBtn = document.getElementById('btn-export');
    if (exportBtn) exportBtn.addEventListener('click', () => Backup.exportData());

    const restoreBtn = document.getElementById('btn-restore');
    if (restoreBtn) restoreBtn.addEventListener('click', () => {
      Backup.showRestoreModal(() => Render.getActiveSpaceId());
    });
  }

  // ─── Schedule button + overdue backup check ────────────────────────────────
  if (ScheduledBackup) {
    const scheduleBtn = document.getElementById('btn-schedule');
    if (scheduleBtn) scheduleBtn.addEventListener('click', () => ScheduledBackup.showSettingsModal());
    ScheduledBackup.initIndicator();
    ScheduledBackup.checkAndBackup();
  }

  // ─── AI toolbar ────────────────────────────────────────────────────────────
  if (AI) {
    function _getActiveSpaceId() {
      const active = document.querySelector('#spaces-list .space-item.active');
      return active ? active.dataset.spaceId : activeSpaceId;
    }
    AI.mountToolbar(_getActiveSpaceId);
  }
})();
