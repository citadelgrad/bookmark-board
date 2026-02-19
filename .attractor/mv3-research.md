# Chrome Manifest V3 Research — Bookmark Board Extension

## 1. manifest.json — Required Fields

```json
{
  "manifest_version": 3,
  "name": "Bookmark Board",
  "version": "1.0.0",
  "description": "New tab bookmark manager",
  "permissions": ["bookmarks", "tabs", "storage", "favicon"],
  "chrome_url_overrides": {
    "newtab": "newtab.html"
  },
  "web_accessible_resources": [
    {
      "resources": ["_favicon/*"],
      "matches": ["<all_urls>"]
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### Permission notes

| Permission | Purpose |
|---|---|
| `"bookmarks"` | Read/write bookmark tree via `chrome.bookmarks.*` |
| `"tabs"` | Exposes `tab.url`, `tab.title`, `tab.favIconUrl` in query results and `onUpdated` changeInfo; without it these fields are empty strings |
| `"storage"` | Required for `chrome.storage.local.*` and `chrome.storage.sync.*` |
| `"favicon"` | Required for the `/_favicon/` endpoint (MV3 replacement for `chrome://favicon/`) |

The `web_accessible_resources` entry for `_favicon/*` is only needed when fetching favicons from a **content script**. From the newtab extension page itself, `"favicon"` permission alone is sufficient.

---

## 2. chrome_url_overrides for New Tab

```json
"chrome_url_overrides": {
  "newtab": "newtab.html"
}
```

### Constraints and behavior

- Only **one Chrome page** can be overridden per extension (newtab, bookmarks, or history).
- If multiple extensions override newtab, the **last installed** wins.
- **Incognito windows are excluded** — extension cannot override newtab in incognito.
- Initial keyboard focus goes to the **address bar**, not the page body (same as Chrome's default newtab).
- Users expect new tabs to open instantly — avoid blocking operations on load; prefer async patterns.

### Minimal newtab.html

```html
<!DOCTYPE html>
<html>
  <head>
    <title>New Tab</title>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="newtab.css" />
  </head>
  <body>
    <script src="newtab.js" type="module"></script>
  </body>
</html>
```

---

## 3. Favicon API in MV3

The old `chrome://favicon/` URL from MV2 is **gone** in MV3. The replacement is a `/_favicon/` endpoint scoped to the extension's origin.

### URL format

```javascript
function faviconURL(pageUrl, size = 32) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", String(size));
  return url.toString();
}

// Usage
imgElement.src = faviconURL("https://github.com");
// → chrome-extension://EXTENSION_ID/_favicon/?pageUrl=https%3A%2F%2Fgithub.com&size=32
```

- `size` parameter: pixel dimension — `16` (tab size) or `32` (larger) are most common.
- Returns the browser's cached favicon if available; falls back to a generic globe icon.

### Usage in rendering

```javascript
function renderBookmark(node) {
  const item = document.createElement("div");
  const img = document.createElement("img");
  img.src = faviconURL(node.url, 16);
  img.width = 16;
  img.height = 16;
  img.alt = "";
  const label = document.createElement("span");
  label.textContent = node.title;
  item.appendChild(img);
  item.appendChild(label);
  return item;
}
```

---

## 4. chrome.storage.local API

### set()

```javascript
await chrome.storage.local.set({ layout: "grid", columns: 4 });
```

### get()

```javascript
// Single key
const { layout } = await chrome.storage.local.get("layout");

// Multiple keys
const { layout, columns } = await chrome.storage.local.get(["layout", "columns"]);

// All keys
const everything = await chrome.storage.local.get(null);

// With defaults (returns default if key absent)
const { layout } = await chrome.storage.local.get({ layout: "list" });
```

### remove() / clear()

```javascript
await chrome.storage.local.remove("layout");
await chrome.storage.local.remove(["layout", "columns"]);
await chrome.storage.local.clear();
```

### onChanged — react to changes across contexts

```javascript
// Global listener (all storage areas)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
    if (key === "layout") applyLayout(newValue);
  }
});

// Area-scoped listener (Chrome 73+, preferred)
chrome.storage.local.onChanged.addListener((changes) => {
  for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
    console.log(`"${key}": ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`);
  }
});
```

`onChanged` fires in **all extension contexts** (service worker, newtab page, popup, content scripts).

---

## 5. chrome.bookmarks.getSubTree — Bookmark Bar

### Well-known node IDs (stable, permanent)

| ID | Node |
|---|---|
| `"0"` | Root |
| `"1"` | **Bookmarks Bar** |
| `"2"` | Other Bookmarks |
| `"3"` | Mobile Bookmarks (when sync enabled) |

### API call

```javascript
const [bookmarkBarNode] = await chrome.bookmarks.getSubTree("1");
```

### BookmarkTreeNode structure

```typescript
interface BookmarkTreeNode {
  id: string;               // unique, stable across restarts
  title: string;            // display name
  url?: string;             // present for bookmarks, absent for folders
  parentId?: string;        // absent for root node
  index?: number;           // 0-based position within parent
  children?: BookmarkTreeNode[]; // present for folders, absent for bookmarks
  dateAdded?: number;       // ms since epoch
  dateGroupModified?: number; // ms since epoch, folders only
  dateLastUsed?: number;    // ms since epoch, Chrome 114+
  unmodifiable?: "managed"; // system-managed (policy) nodes
}
```

**Bookmark vs folder**: `node.url !== undefined` → bookmark leaf; no `url` → folder with `children`.

### Example tree shape from getSubTree("1")

```javascript
{
  id: "1",
  title: "Bookmarks bar",
  children: [
    {
      id: "10",
      title: "GitHub",
      url: "https://github.com",
      parentId: "1",
      index: 0,
      dateAdded: 1700000000000
    },
    {
      id: "11",
      title: "Dev Tools",         // folder
      parentId: "1",
      index: 1,
      children: [
        {
          id: "12",
          title: "MDN",
          url: "https://developer.mozilla.org",
          parentId: "11",
          index: 0
        }
      ]
    }
  ]
}
```

### Recursive walk helper

```javascript
function walkTree(node, depth = 0) {
  const indent = "  ".repeat(depth);
  if (node.url) {
    console.log(`${indent}[link] ${node.title} → ${node.url}`);
  } else {
    console.log(`${indent}[folder] ${node.title}`);
    for (const child of node.children ?? []) walkTree(child, depth + 1);
  }
}
```

---

## 6. chrome.tabs API

### Permission matrix

| Operation | Requires `"tabs"` permission? |
|---|---|
| `tabs.query()` — basic (id, status) | No |
| `tabs.query()` — `tab.url`, `tab.title`, `tab.favIconUrl` | **Yes** |
| `onCreated` event | No |
| `onUpdated` — basic event | No |
| `onUpdated` — `changeInfo.url`, `changeInfo.title`, `tab.favIconUrl` | **Yes** |
| `onRemoved` event | No |

### chrome.tabs.query

```javascript
// Active tab in focused window
const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

// All tabs in current window
const allTabs = await chrome.tabs.query({ currentWindow: true });

// All HTTP/HTTPS tabs across all windows
const webTabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
```

`queryInfo` accepts: `active`, `audible`, `currentWindow`, `discarded`, `groupId`, `highlighted`,
`index`, `lastFocusedWindow`, `muted`, `pinned`, `status` (`"loading"|"complete"`), `title`, `url`,
`windowId`, `windowType`.

### chrome.tabs.onCreated

```javascript
chrome.tabs.onCreated.addListener((tab) => {
  // tab.url is often NOT set yet at creation time
  // Wait for onUpdated status==="complete" to get the resolved URL
  console.log("New tab created, id:", tab.id);
});
```

### chrome.tabs.onUpdated

```javascript
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    console.log("Tab finished loading:", tab.url);
  }
  if (changeInfo.url)       console.log(`Tab ${tabId} navigated to: ${changeInfo.url}`);
  if (changeInfo.title)     console.log(`Tab ${tabId} title: ${changeInfo.title}`);
  if (changeInfo.favIconUrl) console.log(`Tab ${tabId} favicon: ${changeInfo.favIconUrl}`);
});
```

`changeInfo` properties: `audible`, `autoDiscardable`, `discarded`, `favIconUrl`, `frozen`,
`groupId`, `mutedInfo`, `pinned`, `status`, `title`, `url`.

### chrome.tabs.onRemoved

```javascript
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  // removeInfo.windowId — window the tab belonged to
  // removeInfo.isWindowClosing — true if whole window is closing
  delete tabState[tabId];
});
```

### Pattern: tracking open tabs for bookmark highlighting

```javascript
// Build initial set on load
async function buildOpenUrlSet() {
  const tabs = await chrome.tabs.query({});
  return new Set(tabs.map(t => t.url).filter(Boolean));
}

// Keep set in sync
const openUrls = await buildOpenUrlSet();

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) openUrls.add(changeInfo.url);
});

chrome.tabs.onRemoved.addListener(async () => {
  // Simplest: rebuild from remaining tabs
  const remaining = await chrome.tabs.query({});
  openUrls.clear();
  for (const t of remaining) if (t.url) openUrls.add(t.url);
});
```

---

## Sources

- [Fetching favicons — Chrome Extensions](https://developer.chrome.com/docs/extensions/how-to/ui/favicons)
- [chrome.storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [chrome.bookmarks API](https://developer.chrome.com/docs/extensions/reference/api/bookmarks)
- [chrome.tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Override Chrome pages](https://developer.chrome.com/docs/extensions/mv3/override/)
- [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
