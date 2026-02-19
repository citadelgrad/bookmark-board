/**
 * store.js — Data persistence layer
 * Single source of truth for all app state, backed by chrome.storage.local.
 * Adds BookmarkBoard.Store to the shared namespace.
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.Store = (function () {
  const { uid } = BookmarkBoard.utils;
  const STORAGE_KEY = 'bb_state';

  // In-memory state — loaded once via init(), mutated in place, flushed via _save()
  let _state = {
    spaces: [],
    collections: [],
    tags: [],
    settings: { theme: 'light' },
  };

  // ─── Internal ──────────────────────────────────────────────────────────────

  async function _load() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) {
      _state = result[STORAGE_KEY];
    }
  }

  async function _save() {
    await chrome.storage.local.set({ [STORAGE_KEY]: _state });
  }

  function _nextOrder(items) {
    if (!items.length) return 0;
    return Math.max(...items.map(i => i.order)) + 1;
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    await _load();

    if (_state.spaces.length === 0) {
      const spaceId = uid('sp');
      const collectionId = uid('col');

      _state.spaces = [{
        id: spaceId,
        name: 'My Collections',
        order: 0,
        collectionIds: [collectionId],
      }];

      _state.collections = [{
        id: collectionId,
        spaceId,
        name: 'Bookmarks',
        tags: [],
        order: 0,
        collapsed: false,
        bookmarks: [],
      }];

      await _save();
    }
  }

  // ─── Space CRUD ────────────────────────────────────────────────────────────

  function getSpaces() {
    return [..._state.spaces].sort((a, b) => a.order - b.order);
  }

  async function addSpace(name) {
    const space = {
      id: uid('sp'),
      name,
      order: _nextOrder(_state.spaces),
      collectionIds: [],
    };
    _state.spaces.push(space);
    await _save();
    return space;
  }

  async function renameSpace(id, name) {
    const space = _state.spaces.find(s => s.id === id);
    if (space) {
      space.name = name;
      await _save();
    }
  }

  async function removeSpace(id) {
    const space = _state.spaces.find(s => s.id === id);
    if (!space) return;

    // Remove all collections belonging to this space
    _state.collections = _state.collections.filter(c => c.spaceId !== id);
    _state.spaces = _state.spaces.filter(s => s.id !== id);
    await _save();
  }

  async function reorderSpaces(orderedIds) {
    orderedIds.forEach((id, index) => {
      const space = _state.spaces.find(s => s.id === id);
      if (space) space.order = index;
    });
    await _save();
  }

  // ─── Collection CRUD ───────────────────────────────────────────────────────

  function getCollections(spaceId) {
    return _state.collections
      .filter(c => c.spaceId === spaceId)
      .sort((a, b) => a.order - b.order);
  }

  async function addCollection(spaceId, name) {
    const spaceCollections = _state.collections.filter(c => c.spaceId === spaceId);
    const collection = {
      id: uid('col'),
      spaceId,
      name,
      tags: [],
      order: _nextOrder(spaceCollections),
      collapsed: false,
      bookmarks: [],
    };

    _state.collections.push(collection);

    const space = _state.spaces.find(s => s.id === spaceId);
    if (space) space.collectionIds.push(collection.id);

    await _save();
    return collection;
  }

  async function renameCollection(id, name) {
    const collection = _state.collections.find(c => c.id === id);
    if (collection) {
      collection.name = name;
      await _save();
    }
  }

  async function removeCollection(id) {
    const collection = _state.collections.find(c => c.id === id);
    if (!collection) return;

    // Remove from parent space's collectionIds list
    const space = _state.spaces.find(s => s.id === collection.spaceId);
    if (space) {
      space.collectionIds = space.collectionIds.filter(cid => cid !== id);
    }

    _state.collections = _state.collections.filter(c => c.id !== id);
    await _save();
  }

  async function toggleCollapse(id) {
    const collection = _state.collections.find(c => c.id === id);
    if (collection) {
      collection.collapsed = !collection.collapsed;
      await _save();
    }
  }

  async function reorderCollections(spaceId, orderedIds) {
    orderedIds.forEach((id, index) => {
      const collection = _state.collections.find(c => c.id === id);
      if (collection && collection.spaceId === spaceId) {
        collection.order = index;
      }
    });

    const space = _state.spaces.find(s => s.id === spaceId);
    if (space) space.collectionIds = [...orderedIds];

    await _save();
  }

  async function moveCollection(collectionId, targetSpaceId) {
    const collection = _state.collections.find(c => c.id === collectionId);
    if (!collection) return;

    const sourceSpace = _state.spaces.find(s => s.id === collection.spaceId);
    const targetSpace = _state.spaces.find(s => s.id === targetSpaceId);
    if (!sourceSpace || !targetSpace) return;

    // Remove from source space
    sourceSpace.collectionIds = sourceSpace.collectionIds.filter(cid => cid !== collectionId);

    // Add to end of target space
    targetSpace.collectionIds.push(collectionId);

    // Update collection metadata
    const targetCollections = _state.collections.filter(c => c.spaceId === targetSpaceId);
    collection.spaceId = targetSpaceId;
    collection.order = _nextOrder(targetCollections);

    await _save();
  }

  async function setCollectionTags(id, tags) {
    const collection = _state.collections.find(c => c.id === id);
    if (collection) {
      collection.tags = tags;
      await _save();
    }
  }

  // ─── Bookmark CRUD ─────────────────────────────────────────────────────────

  async function addBookmark(collectionId, { title, url }) {
    const collection = _state.collections.find(c => c.id === collectionId);
    if (!collection) return null;

    const bookmark = {
      id: uid('bm'),
      title,
      url,
      order: collection.bookmarks.length,
    };

    collection.bookmarks.push(bookmark);
    await _save();
    return bookmark;
  }

  async function removeBookmark(collectionId, bookmarkId) {
    const collection = _state.collections.find(c => c.id === collectionId);
    if (!collection) return;

    collection.bookmarks = collection.bookmarks.filter(b => b.id !== bookmarkId);

    // Normalize order after removal
    collection.bookmarks.forEach((b, i) => { b.order = i; });
    await _save();
  }

  async function moveBookmark(fromCollectionId, toCollectionId, bookmarkId, newIndex) {
    const fromCollection = _state.collections.find(c => c.id === fromCollectionId);
    const toCollection = _state.collections.find(c => c.id === toCollectionId);
    if (!fromCollection || !toCollection) return;

    const bookmarkIndex = fromCollection.bookmarks.findIndex(b => b.id === bookmarkId);
    if (bookmarkIndex === -1) return;

    const [bookmark] = fromCollection.bookmarks.splice(bookmarkIndex, 1);

    // Clamp insertion index
    const insertAt = Math.min(newIndex, toCollection.bookmarks.length);
    toCollection.bookmarks.splice(insertAt, 0, bookmark);

    // Normalize order in both collections
    fromCollection.bookmarks.forEach((b, i) => { b.order = i; });
    toCollection.bookmarks.forEach((b, i) => { b.order = i; });

    await _save();
  }

  async function reorderBookmarks(collectionId, orderedIds) {
    const collection = _state.collections.find(c => c.id === collectionId);
    if (!collection) return;

    const bookmarkMap = new Map(collection.bookmarks.map(b => [b.id, b]));
    collection.bookmarks = orderedIds
      .filter(id => bookmarkMap.has(id))
      .map((id, index) => {
        const b = bookmarkMap.get(id);
        b.order = index;
        return b;
      });

    await _save();
  }

  // ─── Tag CRUD ──────────────────────────────────────────────────────────────

  function getTags() {
    return [..._state.tags];
  }

  async function addTag(name) {
    if (!_state.tags.includes(name)) {
      _state.tags.push(name);
      await _save();
    }
  }

  async function removeTag(name) {
    _state.tags = _state.tags.filter(t => t !== name);

    // Strip removed tag from all collections
    _state.collections.forEach(c => {
      c.tags = c.tags.filter(t => t !== name);
    });

    await _save();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  return {
    init,
    // Spaces
    getSpaces,
    addSpace,
    renameSpace,
    removeSpace,
    reorderSpaces,
    // Collections
    getCollections,
    addCollection,
    renameCollection,
    removeCollection,
    toggleCollapse,
    reorderCollections,
    moveCollection,
    setCollectionTags,
    // Bookmarks
    addBookmark,
    removeBookmark,
    moveBookmark,
    reorderBookmarks,
    // Tags
    getTags,
    addTag,
    removeTag,
    // Internals exposed for seeding during import
    _save,
    _load,
    get _state() { return _state; },
  };
})();
