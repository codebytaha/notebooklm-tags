// =====================
// NotebookLM Tags - Popup Script
// =====================

// Category Colors (matching content.js)
const CATEGORY_COLORS = [
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
  '#E6C9A8'  // Tan
];

// State
let state = {
  tags: [],
  notebooks: {},
  notebookNames: {},
  settings: {
    removeEmoji: false,
    enlargeText: false
  }
};

let currentTab = 'notebooks';
let editingCategoryIndex = -1;
let pendingAction = null;
let currentPickerNotebookId = null;

// =====================
// Initialization
// =====================
document.addEventListener('DOMContentLoaded', init);

function init() {
  setupEventListeners();
  loadData();
}

function setupEventListeners() {
  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Add category form
  document.getElementById('addCategoryForm').addEventListener('submit', handleAddCategory);

  // Search
  document.getElementById('notebookSearch').addEventListener('input', renderNotebooks);

  // Footer buttons
  document.getElementById('exportBtn').addEventListener('click', handleExport);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', handleImport);
  document.getElementById('clearBtn').addEventListener('click', handleClear);

  // Edit dialog
  document.getElementById('cancelEditBtn').addEventListener('click', closeEditDialog);
  document.getElementById('saveEditBtn').addEventListener('click', handleSaveEdit);
  document.getElementById('editCategoryInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSaveEdit();
  });

  // Confirm dialog
  document.getElementById('cancelConfirmBtn').addEventListener('click', closeConfirmDialog);
  document.getElementById('confirmConfirmBtn').addEventListener('click', handleConfirmAction);

  // Close dialogs on overlay click
  document.getElementById('editDialog').addEventListener('click', (e) => {
    if (e.target.id === 'editDialog') closeEditDialog();
  });
  document.getElementById('confirmDialog').addEventListener('click', (e) => {
    if (e.target.id === 'confirmDialog') closeConfirmDialog();
  });

  // Category picker overlay and close button
  document.getElementById('pickerOverlay').addEventListener('click', closeCategoryPicker);
  document.getElementById('pickerCloseBtn').addEventListener('click', closeCategoryPicker);

  // Settings checkboxes
  document.getElementById('removeEmojiSetting').addEventListener('change', handleRemoveEmojiChange);
  document.getElementById('enlargeTextSetting').addEventListener('change', handleEnlargeTextChange);
}

function switchTab(tabName) {
  currentTab = tabName;
  
  // Update tab buttons
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // Update panels
  document.getElementById('notebooksPanel').classList.toggle('active', tabName === 'notebooks');
  document.getElementById('categoriesPanel').classList.toggle('active', tabName === 'categories');
  document.getElementById('settingsPanel').classList.toggle('active', tabName === 'settings');
}

// =====================
// Data Management
// =====================
async function loadData() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getData' });
    if (response) {
      state.tags = response.tags || [];
      state.notebooks = response.notebooks || {};
      state.notebookNames = response.notebookNames || {};
      state.settings = response.settings || { removeEmoji: false, enlargeText: false };
      render();
      renderSettings();
    }
  } catch (error) {
    console.error('Error loading data:', error);
    showToast('Error loading data');
  }
}

async function saveData() {
  try {
    await chrome.runtime.sendMessage({ action: 'setTags', tags: state.tags });
    await chrome.runtime.sendMessage({ action: 'setNotebooks', notebooks: state.notebooks });
    await chrome.runtime.sendMessage({ action: 'setNotebookNames', notebookNames: state.notebookNames });
  } catch (error) {
    console.error('Error saving data:', error);
    showToast('Error saving data');
  }
}

// =====================
// Color Helpers
// =====================
function getCategoryColor(index) {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

function getCategoryColorByName(categoryName) {
  const index = state.tags.indexOf(categoryName);
  return index >= 0 ? getCategoryColor(index) : CATEGORY_COLORS[0];
}

function getTextColorForBg(bgColor) {
  const hex = bgColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#202124' : '#ffffff';
}

// =====================
// Rendering
// =====================
function render() {
  renderNotebooks();
  renderCategories();
  updateCounts();
}

function updateCounts() {
  const notebookCount = Object.keys(state.notebookNames).length;
  document.getElementById('notebookCount').textContent = notebookCount;
  document.getElementById('categoryCount').textContent = state.tags.length;
}

function renderNotebooks() {
  const container = document.getElementById('notebooksList');
  const searchTerm = document.getElementById('notebookSearch').value.toLowerCase();
  
  // Get notebooks from notebookNames (this is our source of truth for existing notebooks)
  const notebookIds = Object.keys(state.notebookNames);
  
  // Filter by search term
  const filteredIds = notebookIds.filter(id => {
    const name = state.notebookNames[id] || '';
    return name.toLowerCase().includes(searchTerm);
  });
  
  if (filteredIds.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
        </svg>
        <p>${searchTerm ? 'No notebooks found matching your search.' : 'No notebooks yet.<br>Visit NotebookLM to see your notebooks here.'}</p>
      </div>
    `;
    return;
  }
  
  // Group notebooks by category
  const categoryGroups = {};
  const uncategorized = [];
  
  filteredIds.forEach(notebookId => {
    const categories = state.notebooks[notebookId] || [];
    if (categories.length === 0) {
      uncategorized.push(notebookId);
    } else {
      // Add to each category group (notebook can appear in multiple)
      categories.forEach(cat => {
        if (!categoryGroups[cat]) {
          categoryGroups[cat] = [];
        }
        categoryGroups[cat].push(notebookId);
      });
    }
  });
  
  // Sort categories by their order in state.tags
  const sortedCategories = state.tags.filter(tag => categoryGroups[tag] && categoryGroups[tag].length > 0);
  
  let html = '';
  
  // Render categorized notebooks
  sortedCategories.forEach(categoryName => {
    const notebooksInCategory = categoryGroups[categoryName];
    const color = getCategoryColorByName(categoryName);
    
    html += `
      <div class="category-group">
        <div class="category-group-header">
          <span class="category-group-dot" style="background: ${color}"></span>
          <span class="category-group-name">${escapeHtml(categoryName)}</span>
          <span class="category-group-count">${notebooksInCategory.length}</span>
        </div>
        <div class="category-group-list">
          ${notebooksInCategory.map(notebookId => renderNotebookItem(notebookId)).join('')}
        </div>
      </div>
    `;
  });
  
  // Render uncategorized notebooks
  if (uncategorized.length > 0) {
    html += `
      <div class="category-group uncategorized">
        <div class="category-group-header">
          <span class="category-group-dot" style="background: var(--text-secondary)"></span>
          <span class="category-group-name">Uncategorized</span>
          <span class="category-group-count">${uncategorized.length}</span>
        </div>
        <div class="category-group-list">
          ${uncategorized.map(notebookId => renderNotebookItem(notebookId)).join('')}
        </div>
      </div>
    `;
  }
  
  container.innerHTML = html;
  
  // Add event listeners
  container.querySelectorAll('.add-cat-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCategoryPicker(btn.dataset.notebook, btn);
    });
  });
  
  container.querySelectorAll('.cat-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parent = btn.closest('.notebook-cat');
      const notebookId = parent.dataset.notebook;
      const category = parent.dataset.category;
      removeCategoryFromNotebook(notebookId, category);
    });
  });
}

function renderNotebookItem(notebookId) {
  const name = state.notebookNames[notebookId] || 'Untitled Notebook';
  const categories = state.notebooks[notebookId] || [];
  
  const categoriesHtml = categories.map(cat => {
    const color = getCategoryColorByName(cat);
    const textColor = getTextColorForBg(color);
    return `
      <span class="notebook-cat" style="background: ${color}; color: ${textColor}" data-notebook="${notebookId}" data-category="${escapeHtml(cat)}">
        <span class="cat-dot" style="background: ${textColor}40"></span>
        ${escapeHtml(cat)}
        <svg class="cat-remove" viewBox="0 0 24 24" data-action="remove"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </span>
    `;
  }).join('');
  
  return `
    <div class="list-item notebook-item" data-notebook-id="${notebookId}">
      <div class="notebook-header">
        <div class="notebook-icon">
          <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        </div>
        <div class="notebook-info">
          <div class="notebook-name">${escapeHtml(name)}</div>
        </div>
      </div>
      <div class="notebook-categories">
        ${categoriesHtml}
        <button class="add-cat-btn" data-notebook="${notebookId}">
          <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          Add
        </button>
      </div>
    </div>
  `;
}

function renderCategories() {
  const container = document.getElementById('categoriesList');
  
  if (state.tags.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24">
          <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/>
        </svg>
        <p>No categories yet.<br>Create one to get started!</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = state.tags.map((tag, index) => {
    const color = getCategoryColor(index);
    const count = getNotebookCountForCategory(tag);
    
    return `
      <div class="list-item" data-index="${index}">
        <div class="item-color" style="background: ${color}"></div>
        <div class="item-info">
          <div class="item-name">${escapeHtml(tag)}</div>
          <div class="item-meta">${count} notebook${count !== 1 ? 's' : ''}</div>
        </div>
        <div class="item-actions">
          <button class="action-btn edit" title="Rename">
            <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button class="action-btn delete" title="Delete">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  // Add event listeners
  container.querySelectorAll('.list-item').forEach(item => {
    const index = parseInt(item.dataset.index);
    
    item.querySelector('.edit').addEventListener('click', (e) => {
      e.stopPropagation();
      handleEditCategory(index);
    });
    
    item.querySelector('.delete').addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteCategory(index);
    });
  });
}

// =====================
// Category Picker
// =====================
function openCategoryPicker(notebookId, triggerBtn) {
  currentPickerNotebookId = notebookId;
  
  const picker = document.getElementById('categoryPicker');
  const overlay = document.getElementById('pickerOverlay');
  const list = document.getElementById('pickerList');
  
  const notebookCategories = state.notebooks[notebookId] || [];
  
  if (state.tags.length === 0) {
    list.innerHTML = `<div class="picker-empty">No categories available.<br>Create one in the Categories tab.</div>`;
  } else {
    list.innerHTML = state.tags.map((tag, index) => {
      const color = getCategoryColor(index);
      const isSelected = notebookCategories.includes(tag);
      
      return `
        <div class="picker-item ${isSelected ? 'selected' : ''}" data-category="${escapeHtml(tag)}">
          <span class="pick-color" style="background: ${color}"></span>
          <span class="pick-name">${escapeHtml(tag)}</span>
          <svg class="pick-check" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
        </div>
      `;
    }).join('');
    
    // Add click handlers - immediate toggle
    list.querySelectorAll('.picker-item').forEach(item => {
      item.addEventListener('click', () => {
        const category = item.dataset.category;
        toggleCategoryForNotebook(currentPickerNotebookId, category);
        item.classList.toggle('selected');
      });
    });
  }
  
  // Position the picker within popup bounds
  const rect = triggerBtn.getBoundingClientRect();
  const popupHeight = document.body.clientHeight;
  const popupWidth = document.body.clientWidth;
  const pickerHeight = Math.min(state.tags.length * 40 + 50, 300); // Estimate picker height
  
  // Check if picker would go below popup, if so position above the button
  let top = rect.bottom + 4;
  if (top + pickerHeight > popupHeight - 10) {
    top = Math.max(10, rect.top - pickerHeight - 4);
  }
  
  picker.style.top = `${top}px`;
  picker.style.left = `${Math.min(rect.left, popupWidth - 220)}px`;
  picker.style.maxHeight = `${Math.min(300, popupHeight - top - 10)}px`;
  
  picker.classList.add('active');
  overlay.classList.add('active');
}

function closeCategoryPicker() {
  document.getElementById('categoryPicker').classList.remove('active');
  document.getElementById('pickerOverlay').classList.remove('active');
  currentPickerNotebookId = null;
  render(); // Re-render to update the display
}

// =====================
// Category Management
// =====================
function handleAddCategory(e) {
  e.preventDefault();
  
  const input = document.getElementById('newCategoryInput');
  const name = input.value.trim();
  
  if (!name) return;
  
  if (state.tags.some(tag => tag.toLowerCase() === name.toLowerCase())) {
    showToast('Category already exists');
    return;
  }
  
  state.tags.push(name);
  saveData();
  render();
  input.value = '';
  showToast('Category added');
}

function handleEditCategory(index) {
  editingCategoryIndex = index;
  const input = document.getElementById('editCategoryInput');
  input.value = state.tags[index];
  document.getElementById('editDialog').classList.add('active');
  input.focus();
  input.select();
}

function handleSaveEdit() {
  const newName = document.getElementById('editCategoryInput').value.trim();
  
  if (!newName) {
    showToast('Name cannot be empty');
    return;
  }
  
  const duplicate = state.tags.some((tag, idx) => 
    idx !== editingCategoryIndex && tag.toLowerCase() === newName.toLowerCase()
  );
  
  if (duplicate) {
    showToast('Category already exists');
    return;
  }
  
  const oldName = state.tags[editingCategoryIndex];
  
  // Update in notebooks
  Object.keys(state.notebooks).forEach(notebookId => {
    const idx = state.notebooks[notebookId].indexOf(oldName);
    if (idx !== -1) {
      state.notebooks[notebookId][idx] = newName;
    }
  });
  
  state.tags[editingCategoryIndex] = newName;
  
  saveData();
  render();
  closeEditDialog();
  showToast('Category renamed');
}

function handleDeleteCategory(index) {
  const tagName = state.tags[index];
  const count = getNotebookCountForCategory(tagName);
  
  pendingAction = () => {
    // Remove from notebooks
    Object.keys(state.notebooks).forEach(notebookId => {
      const idx = state.notebooks[notebookId].indexOf(tagName);
      if (idx !== -1) {
        state.notebooks[notebookId].splice(idx, 1);
      }
    });
    
    state.tags.splice(index, 1);
    
    saveData();
    render();
    showToast('Category deleted');
  };
  
  showConfirmDialog(
    'Delete Category',
    `Delete "${tagName}"?${count > 0 ? ` It will be removed from ${count} notebook${count !== 1 ? 's' : ''}.` : ''}`
  );
}

// =====================
// Notebook-Category Actions
// =====================
function toggleCategoryForNotebook(notebookId, categoryName) {
  if (!state.notebooks[notebookId]) {
    state.notebooks[notebookId] = [];
  }
  
  const idx = state.notebooks[notebookId].indexOf(categoryName);
  if (idx === -1) {
    state.notebooks[notebookId].push(categoryName);
  } else {
    state.notebooks[notebookId].splice(idx, 1);
  }
  
  saveData();
}

function removeCategoryFromNotebook(notebookId, categoryName) {
  if (!state.notebooks[notebookId]) return;
  
  const idx = state.notebooks[notebookId].indexOf(categoryName);
  if (idx !== -1) {
    state.notebooks[notebookId].splice(idx, 1);
    saveData();
    render();
  }
}

// =====================
// Import/Export
// =====================
async function handleExport() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'exportData' });
    if (response && response.data) {
      const blob = new Blob([response.data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `notebooklm-tags-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Data exported');
    }
  } catch (error) {
    console.error('Export error:', error);
    showToast('Export failed');
  }
}

function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const data = JSON.parse(event.target.result);
      
      if (!data.tags || !Array.isArray(data.tags)) {
        throw new Error('Invalid data format');
      }
      
      const response = await chrome.runtime.sendMessage({
        action: 'importData',
        data: JSON.stringify(data)
      });
      
      if (response && response.success) {
        await loadData();
        showToast('Data imported');
      } else {
        throw new Error('Import failed');
      }
    } catch (error) {
      console.error('Import error:', error);
      showToast('Import failed: Invalid file');
    }
  };
  
  reader.readAsText(file);
  e.target.value = '';
}

function handleClear() {
  pendingAction = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'clearData' });
      if (response && response.success) {
        state.tags = [];
        state.notebooks = {};
        state.notebookNames = {};
        render();
        showToast('All data cleared');
      }
    } catch (error) {
      console.error('Clear error:', error);
      showToast('Clear failed');
    }
  };
  
  showConfirmDialog(
    'Clear All Data',
    'This will delete all categories and notebook assignments. This action cannot be undone.'
  );
}

// =====================
// Dialogs
// =====================
function closeEditDialog() {
  document.getElementById('editDialog').classList.remove('active');
  editingCategoryIndex = -1;
}

function showConfirmDialog(title, message) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('confirmDialog').classList.add('active');
}

function closeConfirmDialog() {
  document.getElementById('confirmDialog').classList.remove('active');
  pendingAction = null;
}

function handleConfirmAction() {
  if (pendingAction) {
    pendingAction();
    pendingAction = null;
  }
  closeConfirmDialog();
}

// =====================
// Settings
// =====================
function renderSettings() {
  const removeEmojiCheckbox = document.getElementById('removeEmojiSetting');
  const enlargeTextCheckbox = document.getElementById('enlargeTextSetting');
  const enlargeTextWrapper = document.getElementById('enlargeTextWrapper');
  
  removeEmojiCheckbox.checked = state.settings.removeEmoji;
  enlargeTextCheckbox.checked = state.settings.enlargeText;
  
  // Enable/disable enlarge text based on remove emoji
  if (state.settings.removeEmoji) {
    enlargeTextCheckbox.disabled = false;
    enlargeTextWrapper.classList.add('enabled');
  } else {
    enlargeTextCheckbox.disabled = true;
    enlargeTextCheckbox.checked = false;
    enlargeTextWrapper.classList.remove('enabled');
  }
}

async function handleRemoveEmojiChange(e) {
  state.settings.removeEmoji = e.target.checked;
  
  // If unchecking, also uncheck enlarge text
  if (!e.target.checked) {
    state.settings.enlargeText = false;
  }
  
  renderSettings();
  await saveSettings();
}

async function handleEnlargeTextChange(e) {
  state.settings.enlargeText = e.target.checked;
  await saveSettings();
}

async function saveSettings() {
  try {
    await chrome.runtime.sendMessage({ action: 'setSettings', settings: state.settings });
  } catch (error) {
    console.error('Error saving settings:', error);
    showToast('Error saving settings');
  }
}

// =====================
// Utilities
// =====================
function getNotebookCountForCategory(categoryName) {
  return Object.values(state.notebooks).filter(cats => cats.includes(categoryName)).length;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

// =====================
// Listen for storage changes
// =====================
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    loadData();
  }
});
