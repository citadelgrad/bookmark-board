# CLAUDE.md

Project-specific instructions for Claude Code in this repository.

## Project

Bookmark Board is a Chrome Manifest V3 extension that replaces the New Tab page with a vanilla-JS bookmark manager.

Key files:
- `manifest.json` — extension manifest
- `newtab.html` — extension entry UI
- `newtab.css` — all styles
- `newtab.js` — bootstrap and orchestration
- `js/store.js` — data layer
- `js/render.js` — UI rendering
- `js/dragdrop.js` — drag and drop behavior
- `js/ai-grouping.js` — AI grouping provider logic
- `tests/` — Vitest tests

## Commands

Run tests:

```bash
npm test
```

Install/update dependencies:

```bash
npm install
```

There is no build step for the extension. Load the repo directly as an unpacked Chrome extension.

## Working rules

- Keep changes small and focused.
- Prefer vanilla JavaScript; do not add frameworks or build tooling unless explicitly requested.
- Run `npm test` after code or dependency changes.
- Do not commit generated/runtime files such as `node_modules/`, `test-results/`, `.tldr/`, or Beads/Dolt runtime files.
- Do not add new Beads/bd-based configuration. Existing Beads metadata may be left alone unless explicitly requested.
- Linear/ZEN is the primary task system for new work.
- If you change tracked files, commit and push before handing off.

## Git handoff

Before finishing a change:

```bash
git status --short --branch
npm test   # when code/deps changed
git pull --rebase --autostash
git push
git status --short --branch
```

Do not say “ready to push”; push the completed work.
