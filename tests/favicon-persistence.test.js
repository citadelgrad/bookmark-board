import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';

// ─── Chrome API mock ────────────────────────────────────────────────────────

const storage = {};

globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn(async (key) => ({ [key]: storage[key] })),
      set: vi.fn(async (obj) => Object.assign(storage, obj)),
    },
  },
  runtime: {
    getURL: (p) => `chrome-extension://FAKE${p}`,
  },
  tabs: { create: vi.fn() },
  windows: { create: vi.fn() },
};

// ─── Load IIFE modules into the global scope ────────────────────────────────

function loadModule(filename) {
  const code = fs.readFileSync(
    path.resolve(__dirname, '..', 'js', filename),
    'utf-8',
  );
  vm.runInThisContext(code, { filename });
}

// ─── Build minimal DOM for render.js using safe DOM methods ─────────────────

function buildTestDOM() {
  document.body.textContent = '';

  const sidebar = document.createElement('div');
  sidebar.id = 'sidebar-left';
  const spacesList = document.createElement('div');
  spacesList.id = 'spaces-list';
  const addSpaceBtn = document.createElement('button');
  addSpaceBtn.id = 'btn-add-space';
  sidebar.append(spacesList, addSpaceBtn);

  const main = document.createElement('div');
  main.id = 'main-area';
  const tagBar = document.createElement('div');
  tagBar.id = 'tag-bar';
  const searchWrapper = document.createElement('div');
  searchWrapper.id = 'search-wrapper';
  const searchInput = document.createElement('input');
  searchInput.id = 'search-input';
  searchWrapper.appendChild(searchInput);
  const container = document.createElement('div');
  container.id = 'collections-container';
  main.append(tagBar, searchWrapper, container);

  document.body.append(sidebar, main);
}

beforeEach(() => {
  // Reset state
  delete storage.bb_state;
  window.BookmarkBoard = undefined;

  buildTestDOM();

  loadModule('utils.js');
  loadModule('store.js');
  loadModule('render.js');
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function seedCollection() {
  const Store = window.BookmarkBoard.Store;
  await Store.init();
  const space = Store._state.spaces[0];
  const col = Store._state.collections[0];

  col.bookmarks = [
    { id: 'bm_1', title: 'Example', url: 'https://example.com', order: 0 },
    { id: 'bm_2', title: 'GitHub', url: 'https://github.com', order: 1 },
  ];
  await Store._save();

  return { spaceId: space.id, collectionId: col.id };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Store.setBookmarkFavicon', () => {
  it('saves a favicon URL on a bookmark and persists it', async () => {
    const { collectionId } = await seedCollection();
    const Store = window.BookmarkBoard.Store;

    await Store.setBookmarkFavicon(collectionId, 'bm_1', 'https://www.google.com/s2/favicons?domain=example.com&sz=32');

    // Check in-memory
    const col = Store._state.collections.find(c => c.id === collectionId);
    const bm = col.bookmarks.find(b => b.id === 'bm_1');
    expect(bm.favicon).toBe('https://www.google.com/s2/favicons?domain=example.com&sz=32');

    // Check it was persisted (written to storage)
    expect(chrome.storage.local.set).toHaveBeenCalled();
  });

  it('does not crash for unknown bookmark', async () => {
    const { collectionId } = await seedCollection();
    const Store = window.BookmarkBoard.Store;
    // Should not throw
    await Store.setBookmarkFavicon(collectionId, 'bm_nonexistent', 'https://example.com/icon.png');
  });
});

describe('Rendering uses persisted favicon', () => {
  it('uses bookmark.favicon as img src when present', async () => {
    const { spaceId, collectionId } = await seedCollection();
    const Store = window.BookmarkBoard.Store;

    // Set a cached favicon on bm_1
    const col = Store._state.collections.find(c => c.id === collectionId);
    col.bookmarks[0].favicon = 'https://www.google.com/s2/favicons?domain=example.com&sz=32';
    await Store._save();

    // Render
    const Render = window.BookmarkBoard.Render;
    Render.renderAll(spaceId);

    // Find the bookmark card for bm_1
    const card = document.querySelector('[data-bookmark-id="bm_1"]');
    expect(card).not.toBeNull();

    const img = card.querySelector('.bookmark-favicon');
    expect(img).not.toBeNull();
    expect(img.src).toBe('https://www.google.com/s2/favicons?domain=example.com&sz=32');
  });

  it('falls back to Chrome favicon API when no cached favicon', async () => {
    const { spaceId } = await seedCollection();

    const Render = window.BookmarkBoard.Render;
    Render.renderAll(spaceId);

    const card = document.querySelector('[data-bookmark-id="bm_1"]');
    const img = card.querySelector('.bookmark-favicon');
    expect(img).not.toBeNull();
    // Should use Chrome's /_favicon/ API
    expect(img.src).toContain('_favicon');
    expect(img.src).toContain('example.com');
  });
});

describe('Refresh Icons persists favicons', () => {
  it('stores Google S2 favicon URLs on bookmarks after refresh', async () => {
    const { spaceId, collectionId } = await seedCollection();
    const Store = window.BookmarkBoard.Store;
    const Render = window.BookmarkBoard.Render;

    Render.renderAll(spaceId);

    // Call the exposed refresh helper
    await Render.refreshCollectionIcons(collectionId);

    // Check that favicons were saved to the data model
    const col = Store._state.collections.find(c => c.id === collectionId);
    const bm1 = col.bookmarks.find(b => b.id === 'bm_1');
    const bm2 = col.bookmarks.find(b => b.id === 'bm_2');

    expect(bm1.favicon).toContain('google.com/s2/favicons');
    expect(bm1.favicon).toContain('example.com');
    expect(bm2.favicon).toContain('google.com/s2/favicons');
    expect(bm2.favicon).toContain('github.com');
  });

  it('persisted favicons survive a full re-render', async () => {
    const { spaceId, collectionId } = await seedCollection();
    const Store = window.BookmarkBoard.Store;
    const Render = window.BookmarkBoard.Render;

    Render.renderAll(spaceId);
    await Render.refreshCollectionIcons(collectionId);

    // Full re-render (simulates switching spaces and coming back)
    Render.renderAll(spaceId);

    // The img src should still be the Google S2 URL, not Chrome's /_favicon/
    const card = document.querySelector('[data-bookmark-id="bm_1"]');
    const img = card.querySelector('.bookmark-favicon');
    expect(img).not.toBeNull();
    expect(img.src).toContain('google.com/s2/favicons');
    expect(img.src).not.toContain('_favicon');
  });
});
