/**
 * backup.js — Data export & restore
 * Exports Store state as a JSON file download, and restores from a previously
 * exported JSON file via a modal dialog.
 * Adds BookmarkBoard.Backup to the shared namespace.
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.Backup = (function () {
  const Store = BookmarkBoard.Store;

  // ─── Export ──────────────────────────────────────────────────────────────

  /**
   * Serialize current state to JSON and trigger a browser file download.
   * No modal — instant download.
   */
  function exportData() {
    const state = Store._state;
    const wrapper = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: state,
    };

    const json = JSON.stringify(wrapper, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookmark-board-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ─── Restore modal ───────────────────────────────────────────────────────

  /**
   * Display a modal that lets the user pick a JSON backup file and restore it.
   * Follows the same modal pattern as import.js (overlay → dialog → header/body/footer).
   * Reuses `.import-modal-*` CSS classes.
   *
   * @param {() => string} getActiveSpaceId - callback returning the current active space id
   * @returns {Promise<void>}
   */
  function showRestoreModal(getActiveSpaceId) {
    return new Promise(resolve => {
      // Prevent duplicate modals
      const existing = document.getElementById('restore-modal');
      if (existing) { existing.remove(); }

      // ── Overlay ──────────────────────────────────────────────────────────
      const overlay = document.createElement('div');
      overlay.id = 'restore-modal';
      overlay.className = 'import-modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Restore from backup');

      // ── Dialog box ───────────────────────────────────────────────────────
      const dialog = document.createElement('div');
      dialog.className = 'import-modal-dialog';

      // Header
      const header = document.createElement('div');
      header.className = 'import-modal-header';

      const title = document.createElement('h2');
      title.className = 'import-modal-title';
      title.textContent = 'Restore from Backup';

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
      desc.textContent =
        'Select a previously exported Bookmark Board JSON file. This will replace all current data.';

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.json';
      fileInput.className = 'restore-file-input';

      const status = document.createElement('div');
      status.className = 'import-modal-status';
      status.setAttribute('aria-live', 'polite');

      body.append(desc, fileInput, status);

      // Footer
      const footer = document.createElement('div');
      footer.className = 'import-modal-footer';

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'import-modal-btn import-modal-btn--primary';
      restoreBtn.textContent = 'Restore';
      restoreBtn.disabled = true;

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'import-modal-btn import-modal-btn--secondary';
      cancelBtn.textContent = 'Cancel';

      footer.append(restoreBtn, cancelBtn);
      dialog.append(header, body, footer);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      // Focus the file input on open
      fileInput.focus();

      // ── State ────────────────────────────────────────────────────────────
      let parsedData = null;

      // ── Event handlers ───────────────────────────────────────────────────

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

      // File selection → parse & validate
      fileInput.addEventListener('change', () => {
        parsedData = null;
        restoreBtn.disabled = true;
        status.textContent = '';

        const file = fileInput.files[0];
        if (!file) return;

        const reader = new FileReader();

        reader.onerror = () => {
          status.textContent = 'Could not read file.';
        };

        reader.onload = () => {
          try {
            const parsed = JSON.parse(reader.result);

            // Validate structure
            if (!parsed.data || !Array.isArray(parsed.data.spaces) || !Array.isArray(parsed.data.collections)) {
              status.textContent = 'Invalid backup file: missing spaces or collections data.';
              return;
            }

            parsedData = parsed.data;

            const spaceCount = parsedData.spaces.length;
            const collectionCount = parsedData.collections.length;
            const bookmarkCount = parsedData.collections.reduce(
              (sum, c) => sum + (c.bookmarks ? c.bookmarks.length : 0), 0
            );

            status.textContent =
              `Ready to restore: ${spaceCount} space${spaceCount !== 1 ? 's' : ''}, ` +
              `${collectionCount} collection${collectionCount !== 1 ? 's' : ''}, ` +
              `${bookmarkCount} bookmark${bookmarkCount !== 1 ? 's' : ''}.`;

            restoreBtn.disabled = false;
          } catch (e) {
            status.textContent = 'Invalid JSON file. Please select a valid backup.';
          }
        };

        reader.readAsText(file);
      });

      // Restore button
      restoreBtn.addEventListener('click', async () => {
        if (!parsedData) return;

        restoreBtn.disabled = true;
        cancelBtn.disabled = true;
        status.textContent = 'Restoring\u2026';

        try {
          // Replace state with backup data
          const state = Store._state;
          state.spaces = parsedData.spaces;
          state.collections = parsedData.collections;
          state.tags = parsedData.tags || [];
          state.settings = parsedData.settings || { theme: 'light' };

          await Store._save();

          // Re-render with the first space from restored data
          const { Render } = BookmarkBoard;
          const firstSpaceId = state.spaces.length ? state.spaces[0].id : null;
          if (Render && Render.renderAll) {
            Render.renderAll(firstSpaceId);
          }

          // Apply theme from restored settings
          if (state.settings.theme === 'dark') {
            document.body.classList.add('dark');
          } else {
            document.body.classList.remove('dark');
          }

          const spaceCount = state.spaces.length;
          const bookmarkCount = state.collections.reduce(
            (sum, c) => sum + (c.bookmarks ? c.bookmarks.length : 0), 0
          );

          status.textContent =
            `Restored! ${spaceCount} space${spaceCount !== 1 ? 's' : ''} ` +
            `with ${bookmarkCount} bookmark${bookmarkCount !== 1 ? 's' : ''}.`;

          cancelBtn.textContent = 'Close';
          cancelBtn.disabled = false;
        } catch (err) {
          status.textContent = 'Restore failed. Please try again.';
          restoreBtn.disabled = false;
          cancelBtn.disabled = false;
          console.error('[BookmarkBoard] Restore error:', err);
        }
      });
    });
  }

  // ─── Public API ────────────────────────────────────────────────────────

  return {
    exportData,
    showRestoreModal,
  };
})();
