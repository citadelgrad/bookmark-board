# Bookmark Board — Pipeline

**Attractor pipeline:** `pipelines/build-extension.dot`

```bash
ATTRACTOR="/Volumes/qwiizlab/projects/attractor/target/release/attractor-cli"
$ATTRACTOR validate pipelines/build-extension.dot
$ATTRACTOR run pipelines/build-extension.dot -w .
```

## Status Key
- [ ] Not started
- [~] In progress
- [x] Done

---

## Phase 1: Foundation

- [x] **investigate_structure** — Research Chrome MV3 APIs (read-only)
- [x] **scaffold** — Create manifest.json, newtab.html, newtab.css, js/utils.js, icons
- [x] **verify_scaffold** — Gate: validate scaffold is well-formed

## Phase 2: Core UI

- [x] **build_store** — js/store.js: CRUD for spaces, collections, bookmarks, tags
- [x] **build_render** — js/render.js: three-panel UI, sidebar, collection cards, search
- [x] **verify_render** — Gate: validate store + render integration

## Phase 3: Import & Tabs

- [x] **build_import** — js/import.js: Bookmark Bar import, folders to collections
- [x] **build_tabs** — js/tabs.js: Open tabs sidebar, live updates, save session
- [x] **build_dragdrop** — js/dragdrop.js: HTML5 drag & drop for bookmarks and tabs
- [x] **verify_full** — Gate: validate all systems work together

## Phase 4: Enhancements

- [x] **build_ai_grouping** — js/ai-grouping.js: LLM-powered bookmark organization
- [x] **polish** — Context menus, keyboard shortcuts, dark mode, empty states, transitions
