/**
 * utils.js — Shared helper functions
 * Adds helpers to the BookmarkBoard namespace.
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.utils = (function () {
  /**
   * Generate a random ID with a given prefix.
   * @param {string} prefix - e.g. 'sp', 'col', 'bm'
   * @returns {string} e.g. 'sp_a3f7b2'
   */
  function uid(prefix = 'id') {
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${rand}`;
  }

  /**
   * Return the MV3 favicon URL for a given page URL.
   * Requires the "favicon" permission in manifest.json.
   * @param {string} pageUrl - The page whose favicon to fetch
   * @param {number} size - Icon size in pixels (16 or 32)
   * @returns {string} chrome-extension://EXTENSION_ID/_favicon/?pageUrl=...&size=...
   */
  function faviconUrl(pageUrl, size = 32) {
    try {
      const base = chrome.runtime.getURL('/_favicon/');
      const url = new URL(base);
      url.searchParams.set('pageUrl', pageUrl);
      url.searchParams.set('size', String(size));
      return url.toString();
    } catch (_) {
      return '';
    }
  }

  /**
   * Returns a debounced version of fn that only fires after `ms` ms of quiet.
   * @param {Function} fn
   * @param {number} ms
   * @returns {Function}
   */
  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  return { uid, faviconUrl, debounce };
})();
