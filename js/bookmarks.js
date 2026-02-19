/**
 * bookmarks.js — Chrome Bookmarks API helpers
 * Adds BookmarkBoard.bookmarks to the global namespace.
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.bookmarks = (function () {
  /**
   * Fetch the entire Bookmark Bar subtree.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode>}
   */
  async function getBookmarkBar() {
    const [node] = await chrome.bookmarks.getSubTree('1');
    return node;
  }

  /**
   * Fetch the entire bookmark tree from the root.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode[]>}
   */
  async function getFullTree() {
    return chrome.bookmarks.getTree();
  }

  /**
   * Recursively walk a bookmark tree node, calling
   * onBookmark(node) for leaves and onFolder(node) for folders.
   * @param {chrome.bookmarks.BookmarkTreeNode} node
   * @param {object} handlers
   * @param {function} [handlers.onBookmark]
   * @param {function} [handlers.onFolder]
   */
  function walk(node, { onBookmark, onFolder } = {}) {
    if (node.url !== undefined) {
      onBookmark && onBookmark(node);
    } else {
      onFolder && onFolder(node);
      for (const child of node.children ?? []) {
        walk(child, { onBookmark, onFolder });
      }
    }
  }

  /**
   * Flatten a bookmark subtree into a list of bookmark leaf nodes only.
   * @param {chrome.bookmarks.BookmarkTreeNode} node
   * @returns {chrome.bookmarks.BookmarkTreeNode[]}
   */
  function flattenBookmarks(node) {
    const results = [];
    walk(node, { onBookmark: (bm) => results.push(bm) });
    return results;
  }

  return { getBookmarkBar, getFullTree, walk, flattenBookmarks };
})();
