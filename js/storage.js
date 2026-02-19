/**
 * storage.js — Thin wrapper around chrome.storage.local
 * Adds BookmarkBoard.storage to the global namespace.
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.storage = (function () {
  /**
   * Load a value from storage. Returns defaultValue if the key is absent.
   * @param {string} key
   * @param {*} defaultValue
   * @returns {Promise<*>}
   */
  async function load(key, defaultValue = null) {
    const result = await chrome.storage.local.get({ [key]: defaultValue });
    return result[key];
  }

  /**
   * Persist a value to storage.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<void>}
   */
  async function save(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }

  /**
   * Remove one or more keys from storage.
   * @param {string|string[]} keys
   * @returns {Promise<void>}
   */
  async function remove(keys) {
    await chrome.storage.local.remove(keys);
  }

  /**
   * Subscribe to storage changes for a specific key.
   * @param {string} key
   * @param {function(newValue: *, oldValue: *): void} callback
   */
  function onChange(key, callback) {
    chrome.storage.local.onChanged.addListener((changes) => {
      if (key in changes) {
        callback(changes[key].newValue, changes[key].oldValue);
      }
    });
  }

  return { load, save, remove, onChange };
})();
