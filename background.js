/**
 * background.js — Service worker for scheduled backups
 *
 * Handles two save modes from the service worker:
 *   - 'downloads': silent save to Downloads/{folderName}/ via chrome.downloads
 *   - 'ask':       file picker each time via chrome.downloads with saveAs:true
 *
 * The third mode ('folder') uses the File System Access API and is handled
 * by the newtab page (see scheduled-backup.js) since directory handles
 * require a window context.  When the alarm fires in 'folder' mode, we
 * message any open newtab tabs to perform the write.
 */

const ALARM_NAME = 'bb-scheduled-backup';
const SETTINGS_KEY = 'bb_backup_settings';
const STATE_KEY = 'bb_state';
const HISTORY_KEY = 'bb_backup_history';

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
  maxBackups: 10,
  lastBackupAt: null,
};

async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return Object.assign({}, DEFAULT_SETTINGS, result[SETTINGS_KEY]);
}

async function registerAlarm(settings) {
  await chrome.alarms.clear(ALARM_NAME);
  if (!settings.enabled) return;
  const periodInMinutes = FREQ_MINUTES[settings.frequency] || FREQ_MINUTES.daily;
  chrome.alarms.create(ALARM_NAME, { periodInMinutes, delayInMinutes: periodInMinutes });
}

function _buildFilename() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `bookmark-board-backup-${dateStr}.json`;
}

async function performBackup() {
  const settings = await getSettings();

  // 'folder' mode is handled by the newtab page — message it
  if (settings.saveMode === 'folder') {
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('newtab.html') });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'bb-scheduled-backup' });
    }
    // If no newtab tab is open, the backup will happen next time one opens
    // (scheduled-backup.js checks on load if a backup is overdue)
    return;
  }

  // 'downloads' and 'ask' modes — use chrome.downloads
  const result = await chrome.storage.local.get(STATE_KEY);
  const state = result[STATE_KEY];
  if (!state) return;

  const wrapper = {
    version: 1,
    exportedAt: new Date().toISOString(),
    data: state,
  };

  const json = JSON.stringify(wrapper, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const basename = _buildFilename();

  const useFilePicker = settings.saveMode === 'ask';
  const downloadOpts = {
    url,
    saveAs: useFilePicker,
    filename: useFilePicker ? basename : `${settings.folderName}/${basename}`,
  };

  try {
    const downloadId = await chrome.downloads.download(downloadOpts);

    // Update history
    const histResult = await chrome.storage.local.get(HISTORY_KEY);
    const history = histResult[HISTORY_KEY] || [];
    history.push({ downloadId, filename: downloadOpts.filename, timestamp: wrapper.exportedAt });
    await chrome.storage.local.set({ [HISTORY_KEY]: history });

    // Update last backup time
    settings.lastBackupAt = wrapper.exportedAt;
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });

    // Enforce maxBackups (only in downloads mode — can't manage user-placed files)
    if (!useFilePicker && settings.maxBackups > 0 && history.length > settings.maxBackups) {
      const toRemove = history.splice(0, history.length - settings.maxBackups);
      for (const entry of toRemove) {
        try { await chrome.downloads.removeFile(entry.downloadId); } catch (_) {}
        chrome.downloads.erase({ id: entry.downloadId });
      }
      await chrome.storage.local.set({ [HISTORY_KEY]: history });
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) performBackup();
});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await registerAlarm(settings);
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  await registerAlarm(settings);
});
