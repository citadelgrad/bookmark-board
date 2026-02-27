/**
 * scheduled-backup.js — Scheduled backup settings UI + custom folder writes
 *
 * Save modes:
 *   'downloads' — silent save to Downloads/{folderName}/ (service worker handles)
 *   'folder'    — user picks any folder once, we write silently on each new tab load
 *   'ask'       — file picker opens each time (service worker handles)
 *
 * For 'folder' mode, the directory handle is stored in IndexedDB (handles are
 * serializable).  The newtab page checks on load if a backup is overdue and
 * writes directly using the stored handle.  The service worker also messages
 * us when the alarm fires while a newtab tab is open.
 *
 * Adds BookmarkBoard.ScheduledBackup to the shared namespace.
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.ScheduledBackup = (function () {
  const SETTINGS_KEY = 'bb_backup_settings';
  const ALARM_NAME = 'bb-scheduled-backup';
  const IDB_NAME = 'bb-backup-handles';
  const IDB_STORE = 'handles';
  const HANDLE_KEY = 'backupDir';

  const FREQ_MINUTES = {
    every6h: 360,
    daily: 1440,
    weekly: 10080,
  };

  const DEFAULT_SETTINGS = {
    enabled: false,
    frequency: 'daily',
    saveMode: 'downloads',     // 'downloads' | 'folder' | 'ask'
    folderName: 'BookmarkBoard-Backups',
    folderDisplayName: '',     // human-readable name of the picked folder
    maxBackups: 10,
    lastBackupAt: null,
  };

  // ─── IndexedDB helpers for directory handle ──────────────────────────────

  function _openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function _saveDirHandle(handle) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function _loadDirHandle() {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function _clearDirHandle() {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  // ─── Settings helpers ────────────────────────────────────────────────────

  async function loadSettings() {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    return Object.assign({}, DEFAULT_SETTINGS, result[SETTINGS_KEY]);
  }

  async function saveSettings(settings) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    await chrome.alarms.clear(ALARM_NAME);
    if (settings.enabled) {
      const periodInMinutes = FREQ_MINUTES[settings.frequency] || FREQ_MINUTES.daily;
      chrome.alarms.create(ALARM_NAME, { periodInMinutes, delayInMinutes: periodInMinutes });
    }
  }

  // ─── Custom folder backup write ──────────────────────────────────────────

  async function _writeToCustomFolder() {
    const dirHandle = await _loadDirHandle();
    if (!dirHandle) return false;

    // Verify we still have permission
    const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return false;

    const Store = BookmarkBoard.Store;
    const state = Store._state;
    if (!state) return false;

    const wrapper = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: state,
    };

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `bookmark-board-backup-${dateStr}.json`;

    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(wrapper, null, 2));
    await writable.close();

    // Update last backup time
    const settings = await loadSettings();
    settings.lastBackupAt = wrapper.exportedAt;
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });

    // Enforce maxBackups by listing files and removing oldest
    if (settings.maxBackups > 0) {
      const files = [];
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'file' && name.startsWith('bookmark-board-backup-') && name.endsWith('.json')) {
          files.push(name);
        }
      }
      files.sort();
      if (files.length > settings.maxBackups) {
        const toRemove = files.slice(0, files.length - settings.maxBackups);
        for (const name of toRemove) {
          await dirHandle.removeEntry(name);
        }
      }
    }

    return true;
  }

  // ─── Check on newtab load if backup is overdue ───────────────────────────

  async function checkAndBackup() {
    const settings = await loadSettings();
    if (!settings.enabled || settings.saveMode !== 'folder') return;

    const freqMs = (FREQ_MINUTES[settings.frequency] || FREQ_MINUTES.daily) * 60 * 1000;
    const lastAt = settings.lastBackupAt ? new Date(settings.lastBackupAt).getTime() : 0;
    const now = Date.now();

    if (now - lastAt >= freqMs) {
      try {
        await _writeToCustomFolder();
      } catch (err) {
        console.warn('[BookmarkBoard] Scheduled backup to custom folder failed:', err);
      }
    }
  }

  // ─── Listen for service worker alarm messages ────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'bb-scheduled-backup') {
      _writeToCustomFolder().catch(err => {
        console.warn('[BookmarkBoard] Backup via alarm message failed:', err);
      });
    }
  });

  // ─── Settings modal ──────────────────────────────────────────────────────

  function showSettingsModal() {
    const existing = document.getElementById('scheduled-backup-modal');
    if (existing) existing.remove();

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'scheduled-backup-modal';
    overlay.className = 'import-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Scheduled Backup Settings');

    const dialog = document.createElement('div');
    dialog.className = 'import-modal-dialog';

    // Header
    const header = document.createElement('div');
    header.className = 'import-modal-header';
    const title = document.createElement('h2');
    title.className = 'import-modal-title';
    title.textContent = 'Scheduled Backups';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'import-modal-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '\u00D7';
    header.append(title, closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'import-modal-body';

    // Enable toggle
    const enableRow = document.createElement('label');
    enableRow.className = 'schedule-form-row';
    const enableCheck = document.createElement('input');
    enableCheck.type = 'checkbox';
    enableCheck.className = 'schedule-checkbox';
    enableRow.append(enableCheck, document.createTextNode(' Enable scheduled backups'));

    // Frequency
    const freqRow = document.createElement('div');
    freqRow.className = 'schedule-form-row';
    const freqLabel = document.createElement('label');
    freqLabel.textContent = 'Frequency';
    freqLabel.className = 'schedule-label';
    const freqSelect = document.createElement('select');
    freqSelect.className = 'schedule-select';
    [['every6h', 'Every 6 hours'], ['daily', 'Daily'], ['weekly', 'Weekly']].forEach(([val, text]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      freqSelect.appendChild(opt);
    });
    freqRow.append(freqLabel, freqSelect);

    // Save mode
    const modeRow = document.createElement('div');
    modeRow.className = 'schedule-form-row';
    const modeLabel = document.createElement('label');
    modeLabel.textContent = 'Save to';
    modeLabel.className = 'schedule-label';
    const modeSelect = document.createElement('select');
    modeSelect.className = 'schedule-select';
    [
      ['downloads', 'Downloads folder'],
      ['folder', 'Custom folder (iCloud, Desktop, etc.)'],
      ['ask', 'Choose location each time'],
    ].forEach(([val, text]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      modeSelect.appendChild(opt);
    });
    modeRow.append(modeLabel, modeSelect);

    // ── Downloads-mode details ──
    const downloadsDetails = document.createElement('div');
    downloadsDetails.className = 'schedule-mode-details';

    const folderRow = document.createElement('div');
    folderRow.className = 'schedule-form-row';
    const folderLabel = document.createElement('label');
    folderLabel.textContent = 'Subfolder';
    folderLabel.className = 'schedule-label';
    const folderWrap = document.createElement('span');
    folderWrap.className = 'schedule-folder-wrap';
    const folderPrefix = document.createElement('span');
    folderPrefix.className = 'schedule-folder-prefix';
    folderPrefix.textContent = 'Downloads/';
    const folderInput = document.createElement('input');
    folderInput.type = 'text';
    folderInput.className = 'schedule-input';
    folderWrap.append(folderPrefix, folderInput);
    folderRow.append(folderLabel, folderWrap);

    downloadsDetails.append(folderRow);

    // ── Custom folder details ──
    const folderDetails = document.createElement('div');
    folderDetails.className = 'schedule-mode-details';

    const pickRow = document.createElement('div');
    pickRow.className = 'schedule-form-row';
    const pickLabel = document.createElement('label');
    pickLabel.textContent = 'Folder';
    pickLabel.className = 'schedule-label';
    const pickBtn = document.createElement('button');
    pickBtn.className = 'import-modal-btn import-modal-btn--secondary schedule-pick-btn';
    pickBtn.textContent = 'Choose folder\u2026';
    const pickName = document.createElement('span');
    pickName.className = 'schedule-folder-name';
    pickName.textContent = 'No folder selected';
    pickRow.append(pickLabel, pickBtn, pickName);

    const folderHint = document.createElement('div');
    folderHint.className = 'schedule-form-row schedule-hint';
    folderHint.textContent = 'Pick any folder — iCloud Drive, Desktop, external drive, network share.';

    folderDetails.append(pickRow, folderHint);

    // ── Ask-mode hint ──
    const askHint = document.createElement('div');
    askHint.className = 'schedule-mode-details';
    const askText = document.createElement('div');
    askText.className = 'schedule-form-row schedule-hint';
    askText.textContent = 'A file picker will open each time the backup runs.';
    askHint.append(askText);

    // ── Max backups (shared by downloads + folder modes) ──
    const maxRow = document.createElement('div');
    maxRow.className = 'schedule-form-row';
    const maxLabel = document.createElement('label');
    maxLabel.textContent = 'Keep last';
    maxLabel.className = 'schedule-label';
    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.min = '0';
    maxInput.className = 'schedule-input schedule-input--small';
    const maxSuffix = document.createElement('span');
    maxSuffix.className = 'schedule-suffix';
    maxSuffix.textContent = 'backups (0 = unlimited)';
    maxRow.append(maxLabel, maxInput, maxSuffix);

    // Status line
    const statusLine = document.createElement('div');
    statusLine.className = 'import-modal-status';
    statusLine.setAttribute('aria-live', 'polite');

    // Toggle visibility based on mode
    function _toggleMode() {
      const mode = modeSelect.value;
      downloadsDetails.style.display = mode === 'downloads' ? '' : 'none';
      folderDetails.style.display = mode === 'folder' ? '' : 'none';
      askHint.style.display = mode === 'ask' ? '' : 'none';
      maxRow.style.display = mode === 'ask' ? 'none' : '';
    }
    modeSelect.addEventListener('change', _toggleMode);

    body.append(enableRow, freqRow, modeRow, downloadsDetails, folderDetails, askHint, maxRow, statusLine);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'import-modal-footer';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'import-modal-btn import-modal-btn--primary';
    saveBtn.textContent = 'Save';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'import-modal-btn import-modal-btn--secondary';
    cancelBtn.textContent = 'Cancel';
    footer.append(saveBtn, cancelBtn);

    dialog.append(header, body, footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // ── State for folder picker ──
    let pickedHandle = null;

    // Load current settings + existing handle
    Promise.all([loadSettings(), _loadDirHandle()]).then(([settings, existingHandle]) => {
      enableCheck.checked = settings.enabled;
      freqSelect.value = settings.frequency;
      modeSelect.value = settings.saveMode || 'downloads';
      folderInput.value = settings.folderName;
      maxInput.value = settings.maxBackups;

      if (existingHandle) {
        pickedHandle = existingHandle;
        pickName.textContent = settings.folderDisplayName || existingHandle.name;
        pickName.classList.add('schedule-folder-name--set');
      }

      _toggleMode();

      if (settings.lastBackupAt) {
        statusLine.textContent = 'Last backup: ' + new Date(settings.lastBackupAt).toLocaleString();
      } else {
        statusLine.textContent = 'No backups yet.';
      }
    });

    // ── Folder picker ──
    pickBtn.addEventListener('click', async () => {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        pickedHandle = handle;
        pickName.textContent = handle.name;
        pickName.classList.add('schedule-folder-name--set');
      } catch (err) {
        // User cancelled the picker
        if (err.name !== 'AbortError') console.error('[BookmarkBoard] Folder picker error:', err);
      }
    });

    // Close
    function _close() { overlay.remove(); }
    closeBtn.addEventListener('click', _close);
    cancelBtn.addEventListener('click', _close);
    overlay.addEventListener('click', e => { if (e.target === overlay) _close(); });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') _close(); });

    // Save
    saveBtn.addEventListener('click', async () => {
      const mode = modeSelect.value;

      // Validate: folder mode requires a picked handle
      if (mode === 'folder' && !pickedHandle) {
        statusLine.textContent = 'Please choose a folder first.';
        return;
      }

      try {
        // Save or clear directory handle in IndexedDB
        if (mode === 'folder' && pickedHandle) {
          await _saveDirHandle(pickedHandle);
        } else if (mode !== 'folder') {
          await _clearDirHandle().catch(() => {}); // OK if DB doesn't exist yet
        }

        const current = await loadSettings();
        const settings = {
          enabled: enableCheck.checked,
          frequency: freqSelect.value,
          saveMode: mode,
          folderName: folderInput.value.trim() || DEFAULT_SETTINGS.folderName,
          folderDisplayName: pickedHandle ? pickedHandle.name : '',
          maxBackups: parseInt(maxInput.value, 10) || 0,
          lastBackupAt: current.lastBackupAt,
        };

        await saveSettings(settings);

        statusLine.textContent = settings.enabled
          ? 'Scheduled backups enabled.'
          : 'Scheduled backups disabled.';

        _updateIndicator(settings.enabled);
      } catch (err) {
        console.error('[BookmarkBoard] Save settings failed:', err);
        statusLine.textContent = 'Save failed — check console for details.';
      }

      setTimeout(_close, 800);
    });
  }

  function _updateIndicator(enabled) {
    const btn = document.getElementById('btn-schedule');
    if (!btn) return;
    btn.classList.toggle('schedule-active', enabled);
  }

  async function initIndicator() {
    const settings = await loadSettings();
    _updateIndicator(settings.enabled);
  }

  return {
    showSettingsModal,
    initIndicator,
    checkAndBackup,
  };
})();
