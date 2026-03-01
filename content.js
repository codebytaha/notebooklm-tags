/**
 * NotebookLM Tags - Content Script
 * Injects category filter bar and handles notebook tagging
 */

(function() {
  'use strict';

  // =====================
  // Configuration
  // =====================
  const CONFIG = {
    // Selectors - based on actual NotebookLM DOM structure
    notebookGridSelector: '.project-buttons-flow',
    notebookCardSelector: 'project-button.project-button',
    headerSelector: 'header, [class*="header"], [class*="toolbar"]',
    mainContentSelector: 'main, [role="main"], [class*="content"]',
    darkModeSelector: '.dark-theme, [data-theme="dark"], .dark',
    hamburgerMenuSelector: '.project-button-hamburger-menu',
    
    // Storage keys
    storageKeys: {
      tags: 'nlm_organizer_tags',
      notebooks: 'nlm_organizer_notebooks',
      notebookNames: 'nlm_organizer_notebook_names',
      settings: 'nlm_organizer_settings'
    },
    
    // Category colors (vibrant, distinct colors matching NotebookLM aesthetics)
    categoryColors: [
      '#8AB4F8', // Google Blue
      '#F28B82', // Coral Red
      '#81C995', // Green
      '#FDD663', // Yellow
      '#C58AF9', // Purple
      '#78D9EC', // Cyan
      '#FCAD70', // Orange
      '#FF8BCB', // Pink
      '#A8DAB5', // Mint
      '#D7AEFB', // Lavender
      '#AECBFA', // Light Blue
      '#E6C9A8', // Tan
    ],
    
    // Default tags
    defaultTags: []
  };

  // =====================
  // State
  // =====================
  let state = {
    tags: [],
    notebooks: {}, // { notebookId: [tagNames] }
    notebookNames: {}, // { notebookId: notebookName }
    settings: { removeEmoji: false, enlargeText: false },
    activeFilter: 'all',
    isDarkMode: false,
    isInitialized: false
  };

  // =====================
  // Color Management
  // =====================
  function getTagColor(tagName) {
    const index = state.tags.indexOf(tagName);
    if (index === -1) return CONFIG.categoryColors[0];
    return CONFIG.categoryColors[index % CONFIG.categoryColors.length];
  }

  function getTagTextColor(bgColor) {
    // Convert hex to RGB and calculate luminance
    const hex = bgColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#202124' : '#ffffff';
  }

  // =====================
  // Storage Functions
  // =====================
  async function loadFromStorage() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([CONFIG.storageKeys.tags, CONFIG.storageKeys.notebooks, CONFIG.storageKeys.notebookNames, CONFIG.storageKeys.settings], (result) => {
        state.tags = result[CONFIG.storageKeys.tags] || CONFIG.defaultTags;
        state.notebooks = result[CONFIG.storageKeys.notebooks] || {};
        state.notebookNames = result[CONFIG.storageKeys.notebookNames] || {};
        state.settings = result[CONFIG.storageKeys.settings] || { removeEmoji: false, enlargeText: false };
        resolve();
      });
    });
  }

  async function saveToStorage() {
    return new Promise((resolve) => {
      chrome.storage.sync.set({
        [CONFIG.storageKeys.tags]: state.tags,
        [CONFIG.storageKeys.notebooks]: state.notebooks,
        [CONFIG.storageKeys.notebookNames]: state.notebookNames
      }, resolve);
    });
  }

  // =====================
  // Tag Management
  // =====================
  function addTag(tagName) {
    tagName = tagName.trim();
    if (tagName && !state.tags.includes(tagName)) {
      state.tags.push(tagName);
      saveToStorage();
      renderFilterBar();
      return true;
    }
    return false;
  }

  function removeTag(tagName) {
    const index = state.tags.indexOf(tagName);
    if (index > -1) {
      state.tags.splice(index, 1);
      // Remove tag from all notebooks
      Object.keys(state.notebooks).forEach(notebookId => {
        const tagIndex = state.notebooks[notebookId].indexOf(tagName);
        if (tagIndex > -1) {
          state.notebooks[notebookId].splice(tagIndex, 1);
        }
      });
      saveToStorage();
      renderFilterBar();
      applyFilter();
      return true;
    }
    return false;
  }

  function renameTag(oldName, newName) {
    newName = newName.trim();
    if (!newName || state.tags.includes(newName)) return false;
    
    const index = state.tags.indexOf(oldName);
    if (index > -1) {
      state.tags[index] = newName;
      // Update tag in all notebooks
      Object.keys(state.notebooks).forEach(notebookId => {
        const tagIndex = state.notebooks[notebookId].indexOf(oldName);
        if (tagIndex > -1) {
          state.notebooks[notebookId][tagIndex] = newName;
        }
      });
      saveToStorage();
      renderFilterBar();
      if (state.activeFilter === oldName) {
        state.activeFilter = newName;
      }
      applyFilter();
      return true;
    }
    return false;
  }

  // =====================
  // Notebook Tagging
  // =====================
  function extractNotebookId(element) {
    // Try to get ID from aria-labelledby on the button inside (project-{UUID}-title)
    const primaryButton = element.querySelector('button.primary-action-button');
    if (primaryButton) {
      const ariaLabel = primaryButton.getAttribute('aria-labelledby') || '';
      const match = ariaLabel.match(/project-([a-f0-9-]+)-title/);
      if (match) return match[1];
    }
    
    // Try from title span id
    const titleSpan = element.querySelector('.project-button-title');
    if (titleSpan) {
      const titleId = titleSpan.getAttribute('id') || '';
      const match = titleId.match(/project-([a-f0-9-]+)-title/);
      if (match) return match[1];
    }
    
    // Try data attributes
    const dataId = element.getAttribute('data-notebook-id') || 
                   element.getAttribute('data-id') ||
                   element.getAttribute('data-project-id');
    if (dataId) return dataId;
    
    return null;
  }

  function extractNotebookName(element) {
    // Try to get name from title span
    const titleSpan = element.querySelector('.project-button-title');
    if (titleSpan) {
      return titleSpan.textContent.trim();
    }
    
    // Try from aria-label
    const primaryButton = element.querySelector('button.primary-action-button');
    if (primaryButton) {
      const ariaLabel = primaryButton.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel.trim();
    }
    
    return 'Untitled Notebook';
  }

  function assignTagToNotebook(notebookId, tagName) {
    if (!state.notebooks[notebookId]) {
      state.notebooks[notebookId] = [];
    }
    if (!state.notebooks[notebookId].includes(tagName)) {
      state.notebooks[notebookId].push(tagName);
      saveToStorage();
      updateNotebookCardTags(notebookId);
      applyFilter();
    }
  }

  function removeTagFromNotebook(notebookId, tagName) {
    if (state.notebooks[notebookId]) {
      const index = state.notebooks[notebookId].indexOf(tagName);
      if (index > -1) {
        state.notebooks[notebookId].splice(index, 1);
        saveToStorage();
        updateNotebookCardTags(notebookId);
        applyFilter();
      }
    }
  }

  function getNotebookTags(notebookId) {
    return state.notebooks[notebookId] || [];
  }

  // =====================
  // Cleanup Stale Notebooks
  // =====================
  function cleanupStaleNotebooks() {
    // Get all currently visible notebook IDs on the page
    const cards = document.querySelectorAll(CONFIG.notebookCardSelector);
    
    // Don't cleanup if no notebooks are visible yet (page still loading)
    if (cards.length === 0) {
      console.log('[NLM Organizer] No notebooks visible, skipping cleanup');
      return;
    }
    
    const currentNotebookIds = new Set();
    
    cards.forEach(card => {
      const notebookId = extractNotebookId(card);
      if (notebookId) {
        currentNotebookIds.add(notebookId);
      }
    });
    
    // Don't cleanup if we couldn't extract any IDs (something wrong)
    if (currentNotebookIds.size === 0) {
      console.log('[NLM Organizer] Could not extract notebook IDs, skipping cleanup');
      return;
    }
    
    // Remove any stored notebook IDs that are no longer on the page
    let hasChanges = false;
    
    // Clean up notebooks (category assignments)
    Object.keys(state.notebooks).forEach(notebookId => {
      if (!currentNotebookIds.has(notebookId)) {
        delete state.notebooks[notebookId];
        hasChanges = true;
        console.log('[NLM Organizer] Cleaned up stale notebook:', notebookId);
      }
    });
    
    // Clean up notebook names
    Object.keys(state.notebookNames).forEach(notebookId => {
      if (!currentNotebookIds.has(notebookId)) {
        delete state.notebookNames[notebookId];
        hasChanges = true;
      }
    });
    
    if (hasChanges) {
      saveToStorage();
      renderFilterBar(); // Update counts
    }
  }

  // =====================
  // Dark Mode Detection
  // =====================
  function detectDarkMode() {
    const html = document.documentElement;
    const body = document.body;
    
    state.isDarkMode = 
      html.classList.contains('dark-theme') ||
      html.classList.contains('dark') ||
      html.getAttribute('data-theme') === 'dark' ||
      body?.classList.contains('dark-theme') ||
      body?.classList.contains('dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    const filterBar = document.querySelector('.nlm-filter-bar');
    if (filterBar) {
      filterBar.setAttribute('data-theme', state.isDarkMode ? 'dark' : 'light');
    }
  }

  function setupDarkModeObserver() {
    // Watch for class changes on html and body
    const observer = new MutationObserver(() => {
      detectDarkMode();
    });
    
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme']
    });
    
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'data-theme']
      });
    }
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', detectDarkMode);
  }

  // =====================
  // Filter Bar UI (Material Toggle Button Group Style)
  // =====================
  function createFilterBar() {
    const filterBar = document.createElement('div');
    filterBar.className = 'nlm-filter-bar';
    filterBar.setAttribute('data-theme', state.isDarkMode ? 'dark' : 'light');
    filterBar.setAttribute('role', 'radiogroup');
    
    return filterBar;
  }

  function renderFilterBar() {
    let filterBar = document.querySelector('.nlm-filter-bar');
    if (!filterBar) return;
    
    filterBar.setAttribute('data-theme', state.isDarkMode ? 'dark' : 'light');
    
    filterBar.innerHTML = `
      <div class="nlm-toggle-group">
        <button class="nlm-toggle-btn ${state.activeFilter === 'all' ? 'nlm-toggle-checked' : ''}" 
                data-filter="all" role="radio" aria-checked="${state.activeFilter === 'all'}">
          <span class="nlm-toggle-label">All</span>
        </button>
        ${state.tags.map((tag, index) => {
          const color = getTagColor(tag);
          return `
            <button class="nlm-toggle-btn ${state.activeFilter === tag ? 'nlm-toggle-checked' : ''}" 
                    data-filter="${escapeHtml(tag)}" role="radio" aria-checked="${state.activeFilter === tag}"
                    style="--tag-color: ${color}">
              <span class="nlm-toggle-color" style="background: ${color}"></span>
              <span class="nlm-toggle-label">${escapeHtml(tag)}</span>
              <span class="nlm-toggle-count">${getTagCount(tag)}</span>
            </button>
          `;
        }).join('')}
        <button class="nlm-toggle-btn nlm-toggle-add" title="Add new category">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
        </button>
      </div>
    `;
    
    // Attach event listeners
    filterBar.querySelectorAll('.nlm-toggle-btn[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeFilter = btn.dataset.filter;
        renderFilterBar();
        applyFilter();
      });
    });
    
    filterBar.querySelector('.nlm-toggle-add')?.addEventListener('click', showAddTagDialog);
  }

  function getTagCount(tagName) {
    return Object.values(state.notebooks).filter(tags => tags.includes(tagName)).length;
  }

  // =====================
  // Add Tag Dialog
  // =====================
  function showAddTagDialog() {
    // Remove existing dialog
    document.querySelector('.nlm-dialog-overlay')?.remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'nlm-dialog-overlay';
    overlay.setAttribute('data-theme', state.isDarkMode ? 'dark' : 'light');
    
    overlay.innerHTML = `
      <div class="nlm-dialog">
        <div class="nlm-dialog-header">
          <h3>Add New Category</h3>
          <button class="nlm-dialog-close">&times;</button>
        </div>
        <div class="nlm-dialog-content">
          <input type="text" class="nlm-input" placeholder="Category name" autofocus>
        </div>
        <div class="nlm-dialog-actions">
          <button class="nlm-btn nlm-btn-secondary nlm-dialog-cancel">Cancel</button>
          <button class="nlm-btn nlm-btn-primary nlm-dialog-confirm">Add</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    const input = overlay.querySelector('.nlm-input');
    const confirmBtn = overlay.querySelector('.nlm-dialog-confirm');
    const cancelBtn = overlay.querySelector('.nlm-dialog-cancel');
    const closeBtn = overlay.querySelector('.nlm-dialog-close');
    
    const closeDialog = () => overlay.remove();
    
    const handleAdd = () => {
      const tagName = input.value.trim();
      if (tagName) {
        if (addTag(tagName)) {
          closeDialog();
        } else {
          input.classList.add('nlm-input-error');
          input.placeholder = 'Tag already exists';
          input.value = '';
        }
      }
    };
    
    confirmBtn.addEventListener('click', handleAdd);
    cancelBtn.addEventListener('click', closeDialog);
    closeBtn.addEventListener('click', closeDialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleAdd();
    });
    
    input.focus();
  }

  // =====================
  // Notebook Card Category UI (Color-based)
  // =====================
  function addTagButtonToCard(card) {
    const notebookId = extractNotebookId(card);
    if (!notebookId) return;
    
    card.setAttribute('data-nlm-id', notebookId);
    
    // Extract and store notebook name
    const notebookName = extractNotebookName(card);
    if (notebookName && state.notebookNames[notebookId] !== notebookName) {
      state.notebookNames[notebookId] = notebookName;
      saveToStorage();
    }
    
    // Update color indicator
    updateNotebookCardColor(notebookId);
    
    // Watch for hamburger menu opening to inject our option
    setupHamburgerMenuInjection(card, notebookId);
  }

  function updateNotebookCardColor(notebookId) {
    const card = document.querySelector(`[data-nlm-id="${notebookId}"]`);
    if (!card) return;
    
    // Remove existing color indicator
    card.querySelector('.nlm-card-color-indicator')?.remove();
    
    const tags = getNotebookTags(notebookId);
    if (tags.length === 0) return;
    
    // Create color indicator strip (shows first assigned category color)
    const colorIndicator = document.createElement('div');
    colorIndicator.className = 'nlm-card-color-indicator';
    
    // Show multiple colors if multiple categories
    const colors = tags.map(tag => getTagColor(tag));
    if (colors.length === 1) {
      colorIndicator.style.background = colors[0];
    } else {
      // Gradient for multiple categories
      colorIndicator.style.background = `linear-gradient(to right, ${colors.join(', ')})`;
    }
    
    // Insert at top of the mat-card
    const matCard = card.querySelector('mat-card');
    if (matCard) {
      matCard.style.position = 'relative';
      matCard.insertBefore(colorIndicator, matCard.firstChild);
    }
  }

  function setupHamburgerMenuInjection(card, notebookId) {
    // Watch for menu button clicks
    const menuBtn = card.querySelector('.project-button-more');
    if (!menuBtn || menuBtn.dataset.nlmWatched) return;
    
    menuBtn.dataset.nlmWatched = 'true';
    
    menuBtn.addEventListener('click', () => {
      // Wait for menu to appear
      setTimeout(() => injectCategoryMenuItem(notebookId), 50);
    });
  }

  function injectCategoryMenuItem(notebookId) {
    // Find the open hamburger menu
    const menu = document.querySelector('.project-button-hamburger-menu');
    if (!menu || menu.querySelector('.nlm-category-menu-item')) return;
    
    const menuItem = document.createElement('button');
    menuItem.className = 'mat-mdc-menu-item mat-focus-indicator project-button-hamburger-menu-action nlm-category-menu-item';
    menuItem.setAttribute('role', 'menuitem');
    menuItem.setAttribute('tabindex', '0');
    
    const currentTags = getNotebookTags(notebookId);
    
    menuItem.innerHTML = `
      <mat-icon role="img" class="mat-icon notranslate google-symbols mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">checklist</mat-icon>
      <span class="mat-mdc-menu-item-text">Categories${currentTags.length > 0 ? ` (${currentTags.length})` : ''}</span>
      <div matripple="" class="mat-ripple mat-mdc-menu-ripple"></div>
    `;
    
    menuItem.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Close the menu properly by pressing Escape
      const escEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true
      });
      menu.dispatchEvent(escEvent);
      
      // Also click backdrop to close
      const backdrop = document.querySelector('.cdk-overlay-backdrop');
      if (backdrop) backdrop.click();
      
      // Show category dialog after menu closes
      setTimeout(() => showCategoryDialog(notebookId), 150);
    });
    
    menu.appendChild(menuItem);
  }

  function showCategoryDialog(notebookId) {
    // Remove existing dialog
    document.querySelector('.nlm-dialog-overlay')?.remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'nlm-dialog-overlay';
    overlay.setAttribute('data-theme', state.isDarkMode ? 'dark' : 'light');
    
    const notebookTags = getNotebookTags(notebookId);
    
    overlay.innerHTML = `
      <div class="nlm-dialog">
        <div class="nlm-dialog-header">
          <h3>Assign Categories</h3>
          <button class="nlm-dialog-close">&times;</button>
        </div>
        <div class="nlm-dialog-content">
          ${state.tags.length === 0 ? `
            <div class="nlm-dialog-empty">
              <p>No categories yet.</p>
              <p>Add one using the + button in the filter bar.</p>
            </div>
          ` : `
            <div class="nlm-category-list">
              ${state.tags.map(tag => {
                const color = getTagColor(tag);
                const isChecked = notebookTags.includes(tag);
                // Create a lighter version of the color for background
                const colorBg = color + '25'; // Add 25 hex (15% opacity)
                return `
                  <label class="nlm-category-item ${isChecked ? 'checked' : ''}" style="--item-color: ${color}; --item-color-bg: ${colorBg}">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} data-tag="${escapeHtml(tag)}">
                    <span class="nlm-category-color" style="background: ${color}"></span>
                    <span class="nlm-category-name">${escapeHtml(tag)}</span>
                  </label>
                `;
              }).join('')}
            </div>
          `}
        </div>
        <div class="nlm-dialog-actions">
          <button class="nlm-btn nlm-btn-primary nlm-dialog-done">Done</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Track pending changes (not saved until Done is clicked)
    const pendingChanges = {
      add: new Set(),
      remove: new Set()
    };
    
    const closeDialog = (applyChanges = false) => {
      if (applyChanges) {
        // Apply all pending changes
        pendingChanges.add.forEach(tag => {
          assignTagToNotebook(notebookId, tag);
        });
        pendingChanges.remove.forEach(tag => {
          removeTagFromNotebook(notebookId, tag);
        });
      }
      overlay.remove();
    };
    
    overlay.querySelector('.nlm-dialog-close').addEventListener('click', () => closeDialog(false));
    overlay.querySelector('.nlm-dialog-done').addEventListener('click', () => closeDialog(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog(false);
    });
    
    // Handle checkbox changes (visual only, save on Done)
    overlay.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        const tag = checkbox.dataset.tag;
        const item = checkbox.closest('.nlm-category-item');
        const wasOriginallyChecked = notebookTags.includes(tag);
        
        if (checkbox.checked) {
          item.classList.add('checked');
          if (wasOriginallyChecked) {
            pendingChanges.remove.delete(tag);
          } else {
            pendingChanges.add.add(tag);
          }
        } else {
          item.classList.remove('checked');
          if (wasOriginallyChecked) {
            pendingChanges.remove.add(tag);
          } else {
            pendingChanges.add.delete(tag);
          }
        }
      });
    });
  }

  // Keep old function name for compatibility but redirect
  function updateNotebookCardTags(notebookId) {
    updateNotebookCardColor(notebookId);
  }

  function showTagDropdown(card, notebookId) {
    showCategoryDialog(notebookId);
  }

  // =====================
  // Filtering Logic
  // =====================
  function applyFilter() {
    const cards = document.querySelectorAll(CONFIG.notebookCardSelector);
    
    cards.forEach(card => {
      const notebookId = extractNotebookId(card);
      if (!notebookId) return;
      
      const tags = getNotebookTags(notebookId);
      const shouldShow = state.activeFilter === 'all' || tags.includes(state.activeFilter);
      
      // project-button is the card itself, just set display on it
      card.style.display = shouldShow ? '' : 'none';
    });
    
    // Update filter bar to show active state
    renderFilterBar();
  }

  // =====================
  // DOM Injection
  // =====================
  function injectFilterBar() {
    if (document.querySelector('.nlm-filter-bar')) return;
    
    // Find the best injection point
    let targetElement = null;
    let insertPosition = 'beforebegin';
    
    // Try to find the notebooks grid container (.project-buttons-flow)
    const possibleContainers = [
      '.project-buttons-flow',
      '[class*="project-buttons"]',
      'project-button',
      'main [role="list"]',
      'main > div > div'
    ];
    
    for (const selector of possibleContainers) {
      const element = document.querySelector(selector);
      if (element) {
        // For project-button, we want its parent
        if (selector === 'project-button') {
          targetElement = element.parentElement;
        } else {
          targetElement = element;
        }
        break;
      }
    }
    
    // Fallback: insert after header or at top of main
    if (!targetElement) {
      targetElement = document.querySelector('main') || document.querySelector('[role="main"]');
      if (targetElement) {
        insertPosition = 'afterbegin';
      }
    }
    
    if (targetElement) {
      const filterBar = createFilterBar();
      targetElement.insertAdjacentElement(insertPosition, filterBar);
      renderFilterBar();
      console.log('[NLM Organizer] Filter bar injected');
    } else {
      console.log('[NLM Organizer] Could not find injection point');
    }
  }

  function processNotebookCards() {
    const cards = document.querySelectorAll(CONFIG.notebookCardSelector);
    cards.forEach(card => addTagButtonToCard(card));
  }

  // =====================
  // Initialization
  // =====================
  function init() {
    if (state.isInitialized) return;
    
    // Only run on homepage (not inside a notebook)
    if (window.location.pathname.includes('/notebook/')) {
      console.log('[NLM Organizer] Inside notebook view, skipping');
      return;
    }
    
    console.log('[NLM Organizer] Initializing...');
    
    loadFromStorage().then(() => {
      detectDarkMode();
      setupDarkModeObserver();
      injectFilterBar();
      processNotebookCards();
      applyFilter();
      applyDisplaySettings();
      state.isInitialized = true;
      console.log('[NLM Organizer] Initialized with', state.tags.length, 'tags');
      
      // Delay cleanup to ensure all notebooks have loaded
      setTimeout(() => {
        cleanupStaleNotebooks();
      }, 2000);
    });
  }

  // =====================
  // Mutation Observer
  // =====================
  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      let shouldCleanup = false;
      
      for (const mutation of mutations) {
        // Check for added nodes
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if new notebook cards were added
              if (node.matches?.(CONFIG.notebookCardSelector) || 
                  node.querySelector?.(CONFIG.notebookCardSelector)) {
                shouldProcess = true;
                break;
              }
            }
          }
        }
        
        // Check for removed nodes (notebook deletion)
        if (mutation.removedNodes.length > 0) {
          for (const node of mutation.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches?.(CONFIG.notebookCardSelector) || 
                  node.querySelector?.(CONFIG.notebookCardSelector)) {
                shouldCleanup = true;
                break;
              }
            }
          }
        }
        
        if (shouldProcess && shouldCleanup) break;
      }
      
      if (shouldProcess || shouldCleanup) {
        // Debounce processing
        clearTimeout(window._nlmProcessTimeout);
        window._nlmProcessTimeout = setTimeout(() => {
          if (!document.querySelector('.nlm-filter-bar')) {
            injectFilterBar();
          }
          processNotebookCards();
          if (shouldCleanup) {
            cleanupStaleNotebooks();
          }
          applyFilter();
        }, 100);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // =====================
  // Utility Functions
  // =====================
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // =====================
  // Storage Change Listener (for real-time sync with popup)
  // =====================
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    
    let needsUpdate = false;
    
    if (changes[CONFIG.storageKeys.tags]) {
      state.tags = changes[CONFIG.storageKeys.tags].newValue || [];
      needsUpdate = true;
    }
    
    if (changes[CONFIG.storageKeys.notebooks]) {
      state.notebooks = changes[CONFIG.storageKeys.notebooks].newValue || {};
      needsUpdate = true;
    }
    
    if (changes[CONFIG.storageKeys.notebookNames]) {
      state.notebookNames = changes[CONFIG.storageKeys.notebookNames].newValue || {};
    }
    
    if (needsUpdate) {
      console.log('[NLM Organizer] Storage changed, updating UI...');
      renderFilterBar();
      processNotebookCards();
      applyFilter();
    }
  });

  // =====================
  // Display Settings (Emoji & Text)
  // =====================
  const DISPLAY_SETTINGS_STYLE_ID = 'nlm-organizer-display-settings';
  
  function applyDisplaySettings() {
    // Remove existing style if any
    const existingStyle = document.getElementById(DISPLAY_SETTINGS_STYLE_ID);
    if (existingStyle) {
      existingStyle.remove();
    }
    
    const styles = [];
    
    // Remove emoji setting
    if (state.settings.removeEmoji) {
      // Hide emoji but preserve its space to keep layout intact
      styles.push(`
        .project-button-box-icon[id$="-emoji"] {
          visibility: hidden !important;
          width: 0 !important;
          min-width: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
        }
      `);
      
      // Enlarge text setting (only if emoji is removed)
      if (state.settings.enlargeText) {
        styles.push(`
          /* Slightly enlarged title - keep original alignment */
          .project-button-title {
            font-size: 1.1em !important;
            line-height: 1.3 !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            display: -webkit-box !important;
            -webkit-line-clamp: 3 !important;
            -webkit-box-orient: vertical !important;
            word-break: break-word !important;
            max-width: 100% !important;
          }
          
          /* Slightly adjusted subtitle */
          .project-button-subtitle {
            font-size: 0.95em !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            white-space: nowrap !important;
            max-width: 100% !important;
          }
          
          /* Ensure text stays within card boundaries */
          .project-button-box-text {
            overflow: hidden !important;
            max-width: 100% !important;
          }
        `);
      }
    }
    
    if (styles.length > 0) {
      const styleEl = document.createElement('style');
      styleEl.id = DISPLAY_SETTINGS_STYLE_ID;
      styleEl.textContent = styles.join('\n');
      document.head.appendChild(styleEl);
    }
  }

  // =====================
  // Message Handling (from popup)
  // =====================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'getTags':
        sendResponse({ tags: state.tags, notebooks: state.notebooks });
        break;
      case 'addTag':
        const added = addTag(message.tagName);
        sendResponse({ success: added });
        break;
      case 'removeTag':
        const removed = removeTag(message.tagName);
        sendResponse({ success: removed });
        break;
      case 'renameTag':
        const renamed = renameTag(message.oldName, message.newName);
        sendResponse({ success: renamed });
        break;
      case 'refresh':
        loadFromStorage().then(() => {
          renderFilterBar();
          applyFilter();
          applyDisplaySettings();
          sendResponse({ success: true });
        });
        return true; // Keep channel open for async response
      case 'applySettings':
        state.settings = message.settings;
        applyDisplaySettings();
        sendResponse({ success: true });
        break;
    }
  });

  // =====================
  // Start
  // =====================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
      setupObserver();
    });
  } else {
    init();
    setupObserver();
  }

  // Re-init on navigation (SPA)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      state.isInitialized = false;
      setTimeout(init, 500);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
