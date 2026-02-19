/**
 * ai-grouping.js — AI-powered bookmark organization
 * Adds BookmarkBoard.AI to the shared namespace.
 *
 * Security note: All user-supplied strings (API key, model name, bookmark
 * titles/URLs, suggested collection names) are assigned via textContent —
 * never innerHTML. The API key is stored only in chrome.storage.local and
 * is never logged or sent anywhere other than the configured API endpoint.
 */

window.BookmarkBoard = window.BookmarkBoard || {};

BookmarkBoard.AI = (function () {
  const SETTINGS_KEY = 'bb_ai_settings';

  // Supported providers
  const MODELS = [
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5 (Recommended)', provider: 'anthropic' },
    { value: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5 (Fast)',         provider: 'anthropic' },
    { value: 'gpt-4o-mini',                label: 'GPT-4o Mini (OpenAI)',             provider: 'openai'    },
    { value: 'gpt-4o',                     label: 'GPT-4o (OpenAI)',                  provider: 'openai'    },
  ];

  // ─── Settings persistence ───────────────────────────────────────────────────

  async function _loadSettings() {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    return result[SETTINGS_KEY] || { apiKey: '', model: MODELS[0].value };
  }

  async function _saveSettings(settings) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  function _providerFor(modelValue) {
    const m = MODELS.find(x => x.value === modelValue);
    return m ? m.provider : 'anthropic';
  }

  // ─── API call ───────────────────────────────────────────────────────────────

  /**
   * Send bookmarks to the LLM and get back suggested groupings.
   *
   * @param {Array<{title:string, url:string}>} bookmarks
   * @param {string} apiKey
   * @param {string} model
   * @returns {Promise<Array<{name:string, bookmarkIndices:number[]}>>}
   */
  async function organizeWithAI(bookmarks, apiKey, model) {
    const provider = _providerFor(model);

    const systemPrompt =
      'You are a bookmark organizer. The user will give you a list of bookmarks ' +
      'and you must suggest logical groupings for them. Return ONLY valid JSON with ' +
      'no markdown, no code fences, and no extra commentary.';

    const userPrompt =
      'Given these bookmarks (0-indexed), suggest collection groupings. ' +
      'Return JSON: { "collections": [{ "name": "string", "bookmarkIndices": [number] }] }\n\n' +
      bookmarks.map((b, i) => `${i}. ${b.title} — ${b.url}`).join('\n');

    let responseText;

    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Anthropic API error ${res.status}`);
      }

      const data = await res.json();
      responseText = data.content?.[0]?.text ?? '';

    } else {
      // OpenAI-compatible
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userPrompt   },
          ],
          max_tokens: 2048,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `OpenAI API error ${res.status}`);
      }

      const data = await res.json();
      responseText = data.choices?.[0]?.message?.content ?? '';
    }

    // Strip markdown code fences if the model wrapped its output anyway
    responseText = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (_) {
      throw new Error('Could not parse AI response as JSON. Try again.');
    }

    const collections = parsed.collections;
    if (!Array.isArray(collections)) {
      throw new Error('Unexpected response shape from AI.');
    }

    return collections;
  }

  // ─── Test connection ────────────────────────────────────────────────────────

  async function _testConnection(apiKey, model, statusEl) {
    statusEl.dataset.state = 'pending';
    statusEl.textContent = 'Testing connection\u2026';

    try {
      await organizeWithAI(
        [{ title: 'Example', url: 'https://example.com' }],
        apiKey,
        model
      );
      statusEl.dataset.state = 'ok';
      statusEl.textContent = 'Connection successful \u2714';
    } catch (err) {
      statusEl.dataset.state = 'error';
      statusEl.textContent = 'Error: ' + err.message;
    }
  }

  // ─── Settings modal ─────────────────────────────────────────────────────────

  /**
   * Show a modal for configuring the API key and model.
   * @returns {Promise<void>}
   */
  function showSettingsModal() {
    return new Promise(resolve => {
      const existing = document.getElementById('ai-settings-modal');
      if (existing) { existing.remove(); }

      // Overlay
      const overlay = document.createElement('div');
      overlay.id = 'ai-settings-modal';
      overlay.className = 'ai-modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'AI settings');

      // Dialog
      const dialog = document.createElement('div');
      dialog.className = 'ai-modal-dialog';

      // Header
      const header = document.createElement('div');
      header.className = 'ai-modal-header';

      const title = document.createElement('h2');
      title.className = 'ai-modal-title';
      title.textContent = 'AI Settings';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'ai-modal-close';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.textContent = '\u00D7';

      header.append(title, closeBtn);

      // Body
      const body = document.createElement('div');
      body.className = 'ai-modal-body';

      // Model selector
      const modelLabel = document.createElement('label');
      modelLabel.className = 'ai-modal-label';
      modelLabel.textContent = 'Model';
      modelLabel.setAttribute('for', 'ai-model-select');

      const modelSelect = document.createElement('select');
      modelSelect.id = 'ai-model-select';
      modelSelect.className = 'ai-modal-select';

      MODELS.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.textContent = m.label;
        modelSelect.appendChild(opt);
      });

      // API key
      const keyLabel = document.createElement('label');
      keyLabel.className = 'ai-modal-label';
      keyLabel.textContent = 'API Key';
      keyLabel.setAttribute('for', 'ai-key-input');

      const keyInput = document.createElement('input');
      keyInput.id = 'ai-key-input';
      keyInput.className = 'ai-modal-input';
      keyInput.type = 'password';
      keyInput.placeholder = 'sk-ant-… or sk-…';
      keyInput.autocomplete = 'off';
      keyInput.spellcheck = false;

      const keyHint = document.createElement('p');
      keyHint.className = 'ai-modal-hint';
      keyHint.textContent =
        'Your key is stored locally in this browser only and never shared.';

      // Connection test status
      const testStatus = document.createElement('div');
      testStatus.className = 'ai-modal-test-status';
      testStatus.setAttribute('aria-live', 'polite');

      body.append(modelLabel, modelSelect, keyLabel, keyInput, keyHint, testStatus);

      // Footer
      const footer = document.createElement('div');
      footer.className = 'ai-modal-footer';

      const testBtn = document.createElement('button');
      testBtn.className = 'ai-modal-btn ai-modal-btn--secondary';
      testBtn.textContent = 'Test Connection';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'ai-modal-btn ai-modal-btn--primary';
      saveBtn.textContent = 'Save';

      footer.append(testBtn, saveBtn);
      dialog.append(header, body, footer);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      // Populate saved settings
      _loadSettings().then(settings => {
        const match = MODELS.find(m => m.value === settings.model);
        modelSelect.value = match ? settings.model : MODELS[0].value;
        keyInput.value = settings.apiKey || '';
        keyInput.focus();
      });

      // ── Event handlers ──────────────────────────────────────────────────────

      function _close() {
        overlay.remove();
        resolve();
      }

      closeBtn.addEventListener('click', _close);

      overlay.addEventListener('click', e => {
        if (e.target === overlay) _close();
      });

      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') _close();
      });

      testBtn.addEventListener('click', () => {
        const apiKey = keyInput.value.trim();
        if (!apiKey) {
          testStatus.dataset.state = 'error';
          testStatus.textContent = 'Please enter an API key first.';
          return;
        }
        testStatus.textContent = '';
        _testConnection(apiKey, modelSelect.value, testStatus);
      });

      saveBtn.addEventListener('click', async () => {
        const apiKey = keyInput.value.trim();
        const model  = modelSelect.value;

        saveBtn.disabled = true;
        await _saveSettings({ apiKey, model });
        saveBtn.disabled = false;

        // Update the AI button state
        _refreshAIButton();
        _close();
      });
    });
  }

  // ─── Collect bookmarks for organizing ──────────────────────────────────────

  /**
   * Gather bookmarks from all collections in the active space.
   * Returns flat list with collection reference for apply step.
   *
   * @param {string} spaceId
   * @returns {Array<{title:string, url:string, collectionId:string, bookmarkId:string}>}
   */
  function _gatherBookmarks(spaceId) {
    const Store = BookmarkBoard.Store;
    const collections = Store.getCollections(spaceId);
    const all = [];
    collections.forEach(col => {
      col.bookmarks.forEach(bm => {
        all.push({
          title: bm.title || bm.url,
          url:   bm.url,
          collectionId: col.id,
          bookmarkId:   bm.id,
        });
      });
    });
    return all;
  }

  // ─── Organize modal ─────────────────────────────────────────────────────────

  /**
   * Main flow: collect bookmarks → call AI → show preview → apply or cancel.
   * @param {string} spaceId
   * @returns {Promise<void>}
   */
  function showOrganizeModal(spaceId) {
    return new Promise(resolve => {
      const existing = document.getElementById('ai-organize-modal');
      if (existing) { existing.remove(); }

      const overlay = document.createElement('div');
      overlay.id = 'ai-organize-modal';
      overlay.className = 'ai-modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Organize with AI');

      const dialog = document.createElement('div');
      dialog.className = 'ai-modal-dialog ai-modal-dialog--wide';

      // Header
      const header = document.createElement('div');
      header.className = 'ai-modal-header';

      const title = document.createElement('h2');
      title.className = 'ai-modal-title';
      title.textContent = 'Organize with AI';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'ai-modal-close';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.textContent = '\u00D7';

      header.append(title, closeBtn);

      // Body
      const body = document.createElement('div');
      body.className = 'ai-modal-body';

      // Status / spinner
      const statusEl = document.createElement('div');
      statusEl.className = 'ai-modal-status';
      statusEl.setAttribute('aria-live', 'polite');

      // Preview area (hidden until results arrive)
      const previewEl = document.createElement('div');
      previewEl.className = 'ai-modal-preview';
      previewEl.style.display = 'none';

      body.append(statusEl, previewEl);

      // Footer
      const footer = document.createElement('div');
      footer.className = 'ai-modal-footer';

      const applyBtn = document.createElement('button');
      applyBtn.className = 'ai-modal-btn ai-modal-btn--primary';
      applyBtn.textContent = 'Apply';
      applyBtn.style.display = 'none';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'ai-modal-btn ai-modal-btn--secondary';
      cancelBtn.textContent = 'Cancel';

      footer.append(applyBtn, cancelBtn);
      dialog.append(header, body, footer);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      // ── Event handlers ──────────────────────────────────────────────────────

      function _close() {
        overlay.remove();
        resolve();
      }

      closeBtn.addEventListener('click', _close);
      cancelBtn.addEventListener('click', _close);

      overlay.addEventListener('click', e => {
        if (e.target === overlay) _close();
      });

      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') _close();
      });

      // ── Start organizing ────────────────────────────────────────────────────

      let _suggestions = null; // saved for apply step

      (async () => {
        const allBookmarks = _gatherBookmarks(spaceId);

        if (allBookmarks.length === 0) {
          statusEl.textContent = 'No bookmarks found in this space.';
          return;
        }

        statusEl.textContent =
          `Organizing ${allBookmarks.length} bookmark${allBookmarks.length !== 1 ? 's' : ''} with AI\u2026`;

        // Show spinner
        const spinner = document.createElement('span');
        spinner.className = 'ai-modal-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        statusEl.appendChild(spinner);

        let settings;
        try {
          settings = await _loadSettings();
          if (!settings.apiKey) throw new Error('No API key configured. Open AI Settings first.');

          const simpleBookmarks = allBookmarks.map(b => ({ title: b.title, url: b.url }));
          _suggestions = await organizeWithAI(simpleBookmarks, settings.apiKey, settings.model);
        } catch (err) {
          statusEl.textContent = 'Error: ' + err.message;
          return;
        }

        // Clear spinner and show preview
        statusEl.textContent = '';
        previewEl.style.display = '';

        // Build preview list
        const previewTitle = document.createElement('p');
        previewTitle.className = 'ai-modal-preview-title';
        previewTitle.textContent =
          `AI suggested ${_suggestions.length} collection${_suggestions.length !== 1 ? 's' : ''}:`;
        previewEl.appendChild(previewTitle);

        _suggestions.forEach(group => {
          const section = document.createElement('div');
          section.className = 'ai-modal-preview-group';

          const groupName = document.createElement('div');
          groupName.className = 'ai-modal-preview-group-name';
          groupName.textContent = group.name;
          section.appendChild(groupName);

          const list = document.createElement('ul');
          list.className = 'ai-modal-preview-list';

          (group.bookmarkIndices || []).forEach(idx => {
            const bm = allBookmarks[idx];
            if (!bm) return;

            const li = document.createElement('li');
            li.className = 'ai-modal-preview-item';

            const img = document.createElement('img');
            img.className = 'ai-modal-preview-favicon';
            img.src = `/_favicon/?pageUrl=${encodeURIComponent(bm.url)}&size=16`;
            img.width = 16;
            img.height = 16;
            img.alt = '';
            img.onerror = () => { img.style.display = 'none'; };

            const text = document.createElement('span');
            text.className = 'ai-modal-preview-item-title';
            text.textContent = bm.title || bm.url;

            li.append(img, text);
            list.appendChild(li);
          });

          section.appendChild(list);
          previewEl.appendChild(section);
        });

        applyBtn.style.display = '';

        // ── Apply ─────────────────────────────────────────────────────────────

        applyBtn.addEventListener('click', async () => {
          applyBtn.disabled = true;
          cancelBtn.disabled = true;
          statusEl.textContent = 'Applying\u2026';

          try {
            const Store = BookmarkBoard.Store;

            for (const group of _suggestions) {
              const newCol = await Store.addCollection(spaceId, group.name);

              for (const idx of (group.bookmarkIndices || [])) {
                const bm = allBookmarks[idx];
                if (!bm) continue;

                // Move from original collection into the new one
                await Store.moveBookmark(
                  bm.collectionId,
                  newCol.id,
                  bm.bookmarkId,
                  newCol.bookmarks ? newCol.bookmarks.length : 0
                );
              }
            }

            statusEl.textContent = 'Done! Refresh the page to see the new layout.';

            // Re-render
            const { Render } = BookmarkBoard;
            if (Render && Render.renderAll) {
              Render.renderAll(spaceId);
            }

            applyBtn.style.display = 'none';
            cancelBtn.textContent = 'Close';
            cancelBtn.disabled = false;
          } catch (err) {
            statusEl.textContent = 'Error applying changes: ' + err.message;
            applyBtn.disabled = false;
            cancelBtn.disabled = false;
          }
        });
      })();
    });
  }

  // ─── AI button in topbar ────────────────────────────────────────────────────

  /**
   * Sync the AI button's enabled state with whether an API key is saved.
   */
  function _refreshAIButton() {
    const btn = document.getElementById('btn-ai-organize');
    if (!btn) return;

    _loadSettings().then(settings => {
      if (settings.apiKey) {
        btn.removeAttribute('disabled');
        btn.title = 'Organize bookmarks with AI';
      } else {
        btn.setAttribute('disabled', 'disabled');
        btn.title = 'Configure AI settings first';
      }
    });
  }

  /**
   * Insert the AI toolbar section into the main topbar.
   * Should be called once from newtab.js after the DOM is ready.
   *
   * @param {Function} getActiveSpaceId - returns the current active space id
   */
  function mountToolbar(getActiveSpaceId) {
    const topbar = document.querySelector('.main-topbar');
    if (!topbar) return;

    const aiBar = document.createElement('div');
    aiBar.className = 'ai-toolbar';

    const organizeBtn = document.createElement('button');
    organizeBtn.id = 'btn-ai-organize';
    organizeBtn.className = 'ai-toolbar-btn';
    organizeBtn.setAttribute('disabled', 'disabled');
    organizeBtn.title = 'Configure AI settings first';
    organizeBtn.textContent = '\u2728 Organize with AI';

    const settingsBtn = document.createElement('button');
    settingsBtn.id = 'btn-ai-settings';
    settingsBtn.className = 'ai-toolbar-btn ai-toolbar-btn--ghost';
    settingsBtn.title = 'AI settings';
    settingsBtn.textContent = '\u2699\uFE0F AI Settings';

    aiBar.append(organizeBtn, settingsBtn);
    topbar.prepend(aiBar);

    organizeBtn.addEventListener('click', () => {
      const spaceId = getActiveSpaceId();
      if (spaceId) showOrganizeModal(spaceId);
    });

    settingsBtn.addEventListener('click', () => {
      showSettingsModal();
    });

    // Set initial enabled state
    _refreshAIButton();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    showSettingsModal,
    showOrganizeModal,
    organizeWithAI,
    mountToolbar,
  };
})();
