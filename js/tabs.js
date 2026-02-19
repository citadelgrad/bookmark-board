/**
 * tabs.js — Open tabs sidebar
 * Adds BookmarkBoard.Tabs to the global namespace.
 *
 * Public API:
 *   loadTabs()       — render all open tabs into the right sidebar
 *   setupListeners() — wire live-update chrome event listeners
 *
 * Legacy API (kept for backward compat):
 *   render(container), watch(container), getTabsByWindow()
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.Tabs = (function () {
  const { faviconUrl, debounce, uid } = BookmarkBoard.utils;

  // URLs to hide from the tab list (this extension's newtab page + chrome internals)
  const EXCLUDED_ORIGINS = ['chrome://', 'chrome-extension://', 'about:'];

  function _isExcluded(url) {
    if (!url) return true;
    return EXCLUDED_ORIGINS.some(prefix => url.startsWith(prefix));
  }

  // ─── Data ──────────────────────────────────────────────────────────────────

  /**
   * Query all open tabs grouped by windowId, sorted by windowId.
   * Excludes newtab / extension URLs.
   * @returns {Promise<Map<number, chrome.tabs.Tab[]>>}
   */
  async function getTabsByWindow() {
    const allTabs = await chrome.tabs.query({});
    const byWindow = new Map();

    // Sort windows deterministically by windowId so label numbering is stable
    const sorted = [...allTabs].sort((a, b) => a.windowId - b.windowId);

    for (const tab of sorted) {
      if (_isExcluded(tab.url)) continue;
      if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
      byWindow.get(tab.windowId).push(tab);
    }

    return byWindow;
  }

  // ─── DOM builders ──────────────────────────────────────────────────────────

  /**
   * Build a single tab row element.
   * @param {chrome.tabs.Tab} tab
   * @returns {HTMLElement}
   */
  function _buildTabItem(tab) {
    const item = document.createElement('div');
    item.className = 'tab-item' + (tab.active ? ' active-tab' : '');
    item.dataset.tabId = tab.id;
    item.draggable = true;

    // Store tab data on the element for drag-and-drop consumers
    item.dataset.tabUrl = tab.url || '';
    item.dataset.tabTitle = tab.title || tab.url || '';

    // Favicon
    const img = document.createElement('img');
    img.className = 'tab-favicon';
    img.alt = '';
    img.width = 16;
    img.height = 16;
    img.src = tab.favIconUrl && !tab.favIconUrl.startsWith('chrome')
      ? tab.favIconUrl
      : faviconUrl(tab.url || '', 16);
    img.onerror = () => { img.src = faviconUrl(tab.url || '', 16); };

    // Title
    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';
    titleEl.textContent = tab.title || tab.url || 'New Tab';
    titleEl.title = tab.url || '';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close-btn';
    closeBtn.title = 'Close tab';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.remove(tab.id);
    });

    item.appendChild(img);
    item.appendChild(titleEl);
    item.appendChild(closeBtn);

    // Click → switch to tab
    item.addEventListener('click', () => {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    });

    // Drag start — set transfer data so collections can accept drops
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-tab-url', tab.url || '');
      e.dataTransfer.setData('application/x-tab-title', tab.title || tab.url || '');
      e.dataTransfer.setData('text/uri-list', tab.url || '');
      e.dataTransfer.setData('text/plain', tab.url || '');
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
    });

    return item;
  }

  /**
   * Build the window group section (header + tab rows + save button).
   * @param {number} windowId
   * @param {number} windowIndex  1-based display number
   * @param {chrome.tabs.Tab[]} tabs
   * @param {boolean} collapsed
   * @returns {HTMLElement}
   */
  function _buildWindowGroup(windowId, windowIndex, tabs, collapsed) {
    const group = document.createElement('div');
    group.className = 'tabs-window-group';
    group.dataset.windowId = windowId;

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'tabs-window-header';

    const toggle = document.createElement('button');
    toggle.className = 'tabs-window-toggle';
    toggle.title = collapsed ? 'Expand' : 'Collapse';
    toggle.textContent = collapsed ? '▶' : '▼';

    const label = document.createElement('span');
    label.className = 'tabs-window-label';
    label.textContent = `Window ${windowIndex}`;

    const count = document.createElement('span');
    count.className = 'tabs-window-count';
    count.textContent = tabs.length;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'tabs-save-session-btn';
    saveBtn.title = 'Save all tabs in this window as a new collection';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _saveSession(windowIndex, tabs);
    });

    header.appendChild(toggle);
    header.appendChild(label);
    header.appendChild(count);
    header.appendChild(saveBtn);
    group.appendChild(header);

    // ── Tab rows ──
    const body = document.createElement('div');
    body.className = 'tabs-window-body' + (collapsed ? ' collapsed' : '');

    for (const tab of tabs) {
      body.appendChild(_buildTabItem(tab));
    }

    group.appendChild(body);

    // Collapse toggle handler
    toggle.addEventListener('click', () => {
      const isNowCollapsed = body.classList.toggle('collapsed');
      toggle.textContent = isNowCollapsed ? '▶' : '▼';
      toggle.title = isNowCollapsed ? 'Expand' : 'Collapse';
      // Persist collapsed state
      _collapsedWindows.set(windowId, isNowCollapsed);
    });

    return group;
  }

  /**
   * Build the empty-state placeholder.
   * @returns {HTMLElement}
   */
  function _buildEmptyState() {
    const el = document.createElement('div');
    el.className = 'empty-state';
    const icon = document.createElement('span');
    icon.className = 'empty-state-icon';
    icon.textContent = '\uD83D\uDDC2'; // 🗂
    const msg = document.createElement('span');
    msg.textContent = 'No open tabs';
    el.appendChild(icon);
    el.appendChild(msg);
    return el;
  }

  // ─── State ─────────────────────────────────────────────────────────────────

  // Track which window groups the user has manually collapsed
  const _collapsedWindows = new Map();

  // The container element — set on first loadTabs() call
  let _container = null;

  // ─── Save Session ───────────────────────────────────────────────────────────

  /**
   * Save all tabs in a window as a new collection in the active space.
   * @param {number} windowIndex
   * @param {chrome.tabs.Tab[]} tabs
   */
  async function _saveSession(windowIndex, tabs) {
    const Store = BookmarkBoard.Store;
    if (!Store) return;

    const spaces = Store.getSpaces();
    if (!spaces.length) return;

    // Use the first (active) space
    const spaceId = spaces[0].id;
    const collectionName = `Window ${windowIndex} — ${_formatDate()}`;

    const col = await Store.addCollection(spaceId, collectionName);
    if (!col) return;

    for (const tab of tabs) {
      if (!tab.url || _isExcluded(tab.url)) continue;
      await Store.addBookmark(col.id, {
        title: tab.title || tab.url,
        url: tab.url,
      });
    }

    // Re-render collections if Render is available
    if (BookmarkBoard.Render) {
      BookmarkBoard.Render.renderCollections(spaceId);
    }
  }

  function _formatDate() {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  /**
   * Render all open tabs into the sidebar container.
   * Preserves per-window collapsed state across re-renders.
   * @param {HTMLElement} [containerOverride]  optional override (legacy support)
   */
  async function loadTabs(containerOverride) {
    const container = containerOverride || _container;
    if (!container) return;
    _container = container;

    container.textContent = '';
    const byWindow = await getTabsByWindow();

    if (byWindow.size === 0) {
      container.appendChild(_buildEmptyState());
      return;
    }

    let windowIndex = 0;
    for (const [windowId, tabs] of byWindow) {
      windowIndex++;
      const collapsed = _collapsedWindows.get(windowId) || false;
      container.appendChild(_buildWindowGroup(windowId, windowIndex, tabs, collapsed));
    }
  }

  // ─── Live updates ──────────────────────────────────────────────────────────

  /**
   * Wire chrome event listeners for live tab updates.
   * Debounced to avoid flicker during rapid changes.
   * @param {HTMLElement} [containerOverride]
   */
  function setupListeners(containerOverride) {
    if (containerOverride) _container = containerOverride;

    const rerender = debounce(() => loadTabs(), 300);

    chrome.tabs.onCreated.addListener(rerender);

    chrome.tabs.onRemoved.addListener(rerender);

    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      // Only re-render on meaningful changes
      if (changeInfo.status === 'complete' || changeInfo.title || changeInfo.favIconUrl) {
        rerender();
      }
    });

    chrome.tabs.onMoved.addListener(rerender);

    chrome.tabs.onActivated.addListener(rerender);

    if (chrome.windows) {
      chrome.windows.onCreated.addListener(rerender);
      chrome.windows.onRemoved.addListener((windowId) => {
        _collapsedWindows.delete(windowId);
        rerender();
      });
    }
  }

  // ─── Legacy shim (newtab.js called render/watch before refactor) ───────────

  function render(container) {
    return loadTabs(container);
  }

  function watch(container) {
    return setupListeners(container);
  }

  return {
    // Primary API
    loadTabs,
    setupListeners,
    // Utility (used by drag.js for drop targets)
    getTabsByWindow,
    // Legacy shim
    render,
    watch,
  };
})();
