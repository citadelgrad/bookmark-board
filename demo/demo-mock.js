/**
 * demo-mock.js — Chrome extension API mock + demo seed data
 *
 * This file must be loaded BEFORE any BookmarkBoard modules.
 * It provides a localStorage-backed mock of the chrome.* APIs so the
 * extension can run as a standalone web page for screenshots and demos.
 */

(function () {
  'use strict';

  // ─── Mock chrome.storage.local ─────────────────────────────────────────────

  const _store = {};
  const _changeListeners = [];

  // Hydrate from localStorage on load
  try {
    const saved = localStorage.getItem('bb_demo_storage');
    if (saved) Object.assign(_store, JSON.parse(saved));
  } catch (_) {}

  function _persist() {
    try {
      localStorage.setItem('bb_demo_storage', JSON.stringify(_store));
    } catch (_) {}
  }

  const mockStorage = {
    get(keysOrObj) {
      return new Promise(resolve => {
        if (typeof keysOrObj === 'string') {
          resolve({ [keysOrObj]: _store[keysOrObj] });
        } else if (Array.isArray(keysOrObj)) {
          const result = {};
          keysOrObj.forEach(k => { if (k in _store) result[k] = _store[k]; });
          resolve(result);
        } else if (typeof keysOrObj === 'object' && keysOrObj !== null) {
          const result = {};
          for (const [key, defaultVal] of Object.entries(keysOrObj)) {
            result[key] = key in _store ? _store[key] : defaultVal;
          }
          resolve(result);
        } else {
          resolve({ ..._store });
        }
      });
    },

    set(items) {
      return new Promise(resolve => {
        const changes = {};
        for (const [key, value] of Object.entries(items)) {
          const oldValue = _store[key];
          _store[key] = JSON.parse(JSON.stringify(value));
          changes[key] = { newValue: _store[key], oldValue };
        }
        _persist();
        _changeListeners.forEach(fn => fn(changes));
        resolve();
      });
    },

    remove(keys) {
      return new Promise(resolve => {
        const list = typeof keys === 'string' ? [keys] : keys;
        list.forEach(k => delete _store[k]);
        _persist();
        resolve();
      });
    },

    onChanged: {
      addListener(fn) { _changeListeners.push(fn); },
      removeListener(fn) {
        const idx = _changeListeners.indexOf(fn);
        if (idx >= 0) _changeListeners.splice(idx, 1);
      },
    },
  };

  // ─── Mock chrome.runtime ───────────────────────────────────────────────────

  const mockRuntime = {
    getURL(path) {
      // Return Google S2 favicon service for favicon requests in demo mode
      return window.location.origin + path;
    },
    onMessage: {
      addListener() {},
      removeListener() {},
    },
    id: 'demo-extension-id',
  };

  // ─── Mock chrome.tabs ──────────────────────────────────────────────────────

  function _s2(domain) {
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=16';
  }

  const DEMO_TABS = [
    // Window 1 — Research
    { id: 101, windowId: 1, active: true,  title: 'TypeScript: Documentation',          url: 'https://www.typescriptlang.org/docs/',         favIconUrl: _s2('typescriptlang.org') },
    { id: 102, windowId: 1, active: false, title: 'MDN Web Docs',                       url: 'https://developer.mozilla.org/en-US/',          favIconUrl: _s2('developer.mozilla.org') },
    { id: 103, windowId: 1, active: false, title: 'Stack Overflow',                     url: 'https://stackoverflow.com/',                    favIconUrl: _s2('stackoverflow.com') },
    { id: 104, windowId: 1, active: false, title: 'Can I Use',                          url: 'https://caniuse.com/',                          favIconUrl: _s2('caniuse.com') },
    { id: 105, windowId: 1, active: false, title: 'CSS-Tricks',                         url: 'https://css-tricks.com/',                       favIconUrl: _s2('css-tricks.com') },
    // Window 2 — Productivity
    { id: 201, windowId: 2, active: true,  title: 'GitHub',                             url: 'https://github.com/',                           favIconUrl: _s2('github.com') },
    { id: 202, windowId: 2, active: false, title: 'Gmail - Inbox',                      url: 'https://mail.google.com/',                      favIconUrl: _s2('mail.google.com') },
    { id: 203, windowId: 2, active: false, title: 'Google Calendar',                    url: 'https://calendar.google.com/',                  favIconUrl: _s2('calendar.google.com') },
    { id: 204, windowId: 2, active: false, title: 'Notion – Project Board',             url: 'https://www.notion.so/',                        favIconUrl: _s2('notion.so') },
  ];

  const _tabListeners = { onCreated: [], onRemoved: [], onUpdated: [], onMoved: [], onActivated: [] };

  const mockTabs = {
    query() {
      return Promise.resolve([...DEMO_TABS]);
    },
    create(opts) {
      if (opts && opts.url) {
        window.open(opts.url, '_blank');
      }
      return Promise.resolve({ id: Date.now() });
    },
    update() { return Promise.resolve(); },
    remove() { return Promise.resolve(); },
    onCreated:   { addListener(fn) { _tabListeners.onCreated.push(fn); },   removeListener() {} },
    onRemoved:   { addListener(fn) { _tabListeners.onRemoved.push(fn); },   removeListener() {} },
    onUpdated:   { addListener(fn) { _tabListeners.onUpdated.push(fn); },   removeListener() {} },
    onMoved:     { addListener(fn) { _tabListeners.onMoved.push(fn); },     removeListener() {} },
    onActivated: { addListener(fn) { _tabListeners.onActivated.push(fn); }, removeListener() {} },
  };

  // ─── Mock chrome.windows ───────────────────────────────────────────────────

  const mockWindows = {
    create(opts) {
      if (opts && opts.url) window.open(opts.url, '_blank');
      return Promise.resolve({ id: Date.now() });
    },
    update() { return Promise.resolve(); },
    onCreated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} },
  };

  // ─── Mock chrome.bookmarks ─────────────────────────────────────────────────

  const mockBookmarks = {
    getSubTree() {
      // Return an empty bookmark bar so import modal shows "empty"
      return Promise.resolve([{
        id: '1',
        title: 'Bookmarks Bar',
        children: [],
      }]);
    },
  };

  // ─── Mock chrome.alarms ────────────────────────────────────────────────────

  const mockAlarms = {
    create() {},
    clear() { return Promise.resolve(); },
  };

  // ─── Assemble chrome object ────────────────────────────────────────────────

  window.chrome = {
    storage: { local: mockStorage },
    runtime: mockRuntime,
    tabs: mockTabs,
    windows: mockWindows,
    bookmarks: mockBookmarks,
    alarms: mockAlarms,
  };

  // ─── Demo seed data ────────────────────────────────────────────────────────

  const DEMO_STATE = {
    spaces: [
      { id: 'sp_dev',      name: 'Development',  order: 0, icon: '\u{1F4BB}', collectionIds: ['col_frontend', 'col_backend', 'col_devtools'] },
      { id: 'sp_design',   name: 'Design',       order: 1, icon: '\u{1F3A8}', collectionIds: ['col_inspiration', 'col_resources'] },
      { id: 'sp_personal', name: 'Personal',     order: 2, icon: '\u{2B50}',  collectionIds: ['col_reading', 'col_media', 'col_finance'] },
    ],
    collections: [
      // ── Development space ──
      {
        id: 'col_frontend', spaceId: 'sp_dev', name: 'Frontend', tags: ['web', 'javascript'], order: 0, collapsed: false,
        bookmarks: [
          { id: 'bm_01', title: 'React Documentation',        url: 'https://react.dev/',                          order: 0, favicon: 'https://www.google.com/s2/favicons?domain=react.dev&sz=32' },
          { id: 'bm_02', title: 'Vue.js Guide',               url: 'https://vuejs.org/guide/',                    order: 1, favicon: 'https://www.google.com/s2/favicons?domain=vuejs.org&sz=32' },
          { id: 'bm_03', title: 'Tailwind CSS',               url: 'https://tailwindcss.com/',                    order: 2, favicon: 'https://www.google.com/s2/favicons?domain=tailwindcss.com&sz=32' },
          { id: 'bm_04', title: 'MDN Web Docs',               url: 'https://developer.mozilla.org/en-US/',        order: 3, favicon: 'https://www.google.com/s2/favicons?domain=developer.mozilla.org&sz=32' },
          { id: 'bm_05', title: 'TypeScript Handbook',        url: 'https://www.typescriptlang.org/docs/',        order: 4, favicon: 'https://www.google.com/s2/favicons?domain=typescriptlang.org&sz=32' },
          { id: 'bm_06', title: 'CSS-Tricks',                 url: 'https://css-tricks.com/',                     order: 5, favicon: 'https://www.google.com/s2/favicons?domain=css-tricks.com&sz=32' },
        ],
      },
      {
        id: 'col_backend', spaceId: 'sp_dev', name: 'Backend & APIs', tags: ['backend', 'api'], order: 1, collapsed: false,
        bookmarks: [
          { id: 'bm_07', title: 'Node.js Docs',              url: 'https://nodejs.org/en/docs/',                 order: 0, favicon: 'https://www.google.com/s2/favicons?domain=nodejs.org&sz=32' },
          { id: 'bm_08', title: 'Express.js',                url: 'https://expressjs.com/',                      order: 1, favicon: 'https://www.google.com/s2/favicons?domain=expressjs.com&sz=32' },
          { id: 'bm_09', title: 'PostgreSQL Documentation',  url: 'https://www.postgresql.org/docs/',            order: 2, favicon: 'https://www.google.com/s2/favicons?domain=postgresql.org&sz=32' },
          { id: 'bm_10', title: 'Redis',                     url: 'https://redis.io/docs/',                      order: 3, favicon: 'https://www.google.com/s2/favicons?domain=redis.io&sz=32' },
          { id: 'bm_11', title: 'GraphQL',                   url: 'https://graphql.org/learn/',                  order: 4, favicon: 'https://www.google.com/s2/favicons?domain=graphql.org&sz=32' },
        ],
      },
      {
        id: 'col_devtools', spaceId: 'sp_dev', name: 'Developer Tools', tags: ['tools'], order: 2, collapsed: false,
        bookmarks: [
          { id: 'bm_12', title: 'GitHub',                    url: 'https://github.com/',                         order: 0, favicon: 'https://www.google.com/s2/favicons?domain=github.com&sz=32' },
          { id: 'bm_13', title: 'VS Code',                   url: 'https://code.visualstudio.com/',              order: 1, favicon: 'https://www.google.com/s2/favicons?domain=code.visualstudio.com&sz=32' },
          { id: 'bm_14', title: 'Vercel',                    url: 'https://vercel.com/',                         order: 2, favicon: 'https://www.google.com/s2/favicons?domain=vercel.com&sz=32' },
          { id: 'bm_15', title: 'Docker Hub',                url: 'https://hub.docker.com/',                     order: 3, favicon: 'https://www.google.com/s2/favicons?domain=hub.docker.com&sz=32' },
          { id: 'bm_16', title: 'Postman',                   url: 'https://www.postman.com/',                    order: 4, favicon: 'https://www.google.com/s2/favicons?domain=postman.com&sz=32' },
        ],
      },

      // ── Design space ──
      {
        id: 'col_inspiration', spaceId: 'sp_design', name: 'Inspiration', tags: ['ui', 'inspiration'], order: 0, collapsed: false,
        bookmarks: [
          { id: 'bm_17', title: 'Dribbble',                  url: 'https://dribbble.com/',                       order: 0, favicon: 'https://www.google.com/s2/favicons?domain=dribbble.com&sz=32' },
          { id: 'bm_18', title: 'Behance',                   url: 'https://www.behance.net/',                    order: 1, favicon: 'https://www.google.com/s2/favicons?domain=behance.net&sz=32' },
          { id: 'bm_19', title: 'Awwwards',                  url: 'https://www.awwwards.com/',                   order: 2, favicon: 'https://www.google.com/s2/favicons?domain=awwwards.com&sz=32' },
          { id: 'bm_20', title: 'Mobbin',                    url: 'https://mobbin.com/',                         order: 3, favicon: 'https://www.google.com/s2/favicons?domain=mobbin.com&sz=32' },
        ],
      },
      {
        id: 'col_resources', spaceId: 'sp_design', name: 'Design Resources', tags: ['ui', 'tools'], order: 1, collapsed: false,
        bookmarks: [
          { id: 'bm_21', title: 'Figma',                     url: 'https://www.figma.com/',                      order: 0, favicon: 'https://www.google.com/s2/favicons?domain=figma.com&sz=32' },
          { id: 'bm_22', title: 'Coolors',                   url: 'https://coolors.co/',                         order: 1, favicon: 'https://www.google.com/s2/favicons?domain=coolors.co&sz=32' },
          { id: 'bm_23', title: 'Google Fonts',              url: 'https://fonts.google.com/',                   order: 2, favicon: 'https://www.google.com/s2/favicons?domain=fonts.google.com&sz=32' },
          { id: 'bm_24', title: 'Unsplash',                  url: 'https://unsplash.com/',                       order: 3, favicon: 'https://www.google.com/s2/favicons?domain=unsplash.com&sz=32' },
          { id: 'bm_25', title: 'Heroicons',                 url: 'https://heroicons.com/',                      order: 4, favicon: 'https://www.google.com/s2/favicons?domain=heroicons.com&sz=32' },
        ],
      },

      // ── Personal space ──
      {
        id: 'col_reading', spaceId: 'sp_personal', name: 'Reading List', tags: ['reading'], order: 0, collapsed: false,
        bookmarks: [
          { id: 'bm_26', title: 'Hacker News',               url: 'https://news.ycombinator.com/',               order: 0, favicon: 'https://www.google.com/s2/favicons?domain=news.ycombinator.com&sz=32' },
          { id: 'bm_27', title: 'The Verge',                 url: 'https://www.theverge.com/',                   order: 1, favicon: 'https://www.google.com/s2/favicons?domain=theverge.com&sz=32' },
          { id: 'bm_28', title: 'Ars Technica',              url: 'https://arstechnica.com/',                    order: 2, favicon: 'https://www.google.com/s2/favicons?domain=arstechnica.com&sz=32' },
          { id: 'bm_29', title: 'TechCrunch',                url: 'https://techcrunch.com/',                     order: 3, favicon: 'https://www.google.com/s2/favicons?domain=techcrunch.com&sz=32' },
        ],
      },
      {
        id: 'col_media', spaceId: 'sp_personal', name: 'Entertainment', tags: ['media'], order: 1, collapsed: false,
        bookmarks: [
          { id: 'bm_30', title: 'YouTube',                   url: 'https://www.youtube.com/',                    order: 0, favicon: 'https://www.google.com/s2/favicons?domain=youtube.com&sz=32' },
          { id: 'bm_31', title: 'Spotify',                   url: 'https://open.spotify.com/',                   order: 1, favicon: 'https://www.google.com/s2/favicons?domain=spotify.com&sz=32' },
          { id: 'bm_32', title: 'Reddit',                    url: 'https://www.reddit.com/',                     order: 2, favicon: 'https://www.google.com/s2/favicons?domain=reddit.com&sz=32' },
          { id: 'bm_33', title: 'Twitch',                    url: 'https://www.twitch.tv/',                      order: 3, favicon: 'https://www.google.com/s2/favicons?domain=twitch.tv&sz=32' },
        ],
      },
      {
        id: 'col_finance', spaceId: 'sp_personal', name: 'Finance', tags: ['finance'], order: 2, collapsed: true,
        bookmarks: [
          { id: 'bm_34', title: 'Mint',                      url: 'https://mint.intuit.com/',                    order: 0, favicon: 'https://www.google.com/s2/favicons?domain=mint.intuit.com&sz=32' },
          { id: 'bm_35', title: 'Yahoo Finance',             url: 'https://finance.yahoo.com/',                  order: 1, favicon: 'https://www.google.com/s2/favicons?domain=finance.yahoo.com&sz=32' },
          { id: 'bm_36', title: 'Coinbase',                  url: 'https://www.coinbase.com/',                   order: 2, favicon: 'https://www.google.com/s2/favicons?domain=coinbase.com&sz=32' },
        ],
      },
    ],
    tags: ['web', 'javascript', 'backend', 'api', 'tools', 'ui', 'inspiration', 'reading', 'media', 'finance'],
    settings: { theme: 'light', hasImported: true },
  };

  // Only seed if no existing data
  if (!_store.bb_state) {
    _store.bb_state = DEMO_STATE;
    _persist();
  }
})();
