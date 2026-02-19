/**
 * spaces.js — Spaces sidebar renderer
 * A "space" is a named grouping of collections.
 * Adds BookmarkBoard.spaces to the global namespace.
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.spaces = (function () {
  const { uid } = BookmarkBoard.utils;
  const { load, save, onChange } = BookmarkBoard.storage;

  const STORAGE_KEY = 'spaces';

  /** @type {Array<{id: string, name: string, icon: string}>} */
  let _spaces = [];
  let _activeId = null;

  /** @type {HTMLElement|null} */
  let _container = null;

  /** @type {function|null} Called when active space changes */
  let _onSelect = null;

  /**
   * Load spaces from storage, seeding defaults if empty.
   * @returns {Promise<void>}
   */
  async function init(container, onSelect) {
    _container = container;
    _onSelect = onSelect;

    _spaces = await load(STORAGE_KEY, getDefaults());
    if (_spaces.length === 0) {
      _spaces = getDefaults();
      await save(STORAGE_KEY, _spaces);
    }
    _activeId = _spaces[0]?.id || null;

    render();

    onChange(STORAGE_KEY, (newVal) => {
      _spaces = newVal || [];
      render();
    });
  }

  function getDefaults() {
    return [
      { id: uid('sp'), name: 'Personal', icon: '🏠' },
      { id: uid('sp'), name: 'Work', icon: '💼' },
    ];
  }

  /**
   * Render the spaces list into the container.
   */
  function render() {
    if (!_container) return;
    _container.textContent = '';

    for (const space of _spaces) {
      _container.appendChild(renderSpaceItem(space));
    }
  }

  /**
   * Build a single space list item element.
   * @param {{id: string, name: string, icon: string}} space
   * @returns {HTMLElement}
   */
  function renderSpaceItem(space) {
    const item = document.createElement('div');
    item.className = 'space-item' + (space.id === _activeId ? ' active' : '');
    item.dataset.spaceId = space.id;

    const icon = document.createElement('span');
    icon.className = 'space-icon';
    icon.textContent = space.icon || '📁';

    const name = document.createElement('span');
    name.className = 'space-name';
    name.textContent = space.name;

    item.appendChild(icon);
    item.appendChild(name);

    item.addEventListener('click', () => selectSpace(space.id));

    return item;
  }

  /**
   * Mark a space as active and notify the caller.
   * @param {string} id
   */
  function selectSpace(id) {
    _activeId = id;
    render();
    if (_onSelect) _onSelect(id);
  }

  /**
   * Add a new space and persist it.
   * @param {string} name
   * @param {string} [icon]
   */
  async function addSpace(name, icon = '📁') {
    const space = { id: uid('sp'), name, icon };
    _spaces.push(space);
    await save(STORAGE_KEY, _spaces);
    render();
    selectSpace(space.id);
  }

  function getActive() {
    return _spaces.find((s) => s.id === _activeId) || null;
  }

  function getAll() {
    return [..._spaces];
  }

  return { init, addSpace, getActive, getAll, selectSpace };
})();
