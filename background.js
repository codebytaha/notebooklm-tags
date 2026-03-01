/**
 * NotebookLM Tags - Background Service Worker
 * Handles storage operations and message passing
 */

const STORAGE_KEYS = {
  tags: 'nlm_organizer_tags',
  notebooks: 'nlm_organizer_notebooks',
  notebookNames: 'nlm_organizer_notebook_names',
  settings: 'nlm_organizer_settings'
};

// Initialize default data on install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[NLM Organizer] Extension installed');
    
    // Set default empty data
    chrome.storage.sync.set({
      [STORAGE_KEYS.tags]: [],
      [STORAGE_KEYS.notebooks]: {}
    });
  }
});

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'getData':
      getData().then(sendResponse);
      return true; // Keep channel open for async response
      
    case 'setTags':
      setTags(message.tags).then(sendResponse);
      return true;
      
    case 'setNotebooks':
      setNotebooks(message.notebooks).then(sendResponse);
      return true;
    
    case 'setNotebookNames':
      setNotebookNames(message.notebookNames).then(sendResponse);
      return true;
    
    case 'getSettings':
      getSettings().then(sendResponse);
      return true;
    
    case 'setSettings':
      setSettings(message.settings).then(sendResponse);
      return true;
      
    case 'exportData':
      exportData().then(sendResponse);
      return true;
      
    case 'importData':
      importData(message.data).then(sendResponse);
      return true;
      
    case 'clearData':
      clearData().then(sendResponse);
      return true;
  }
});

// Storage functions
async function getData() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.tags, STORAGE_KEYS.notebooks, STORAGE_KEYS.notebookNames, STORAGE_KEYS.settings], (result) => {
      resolve({
        tags: result[STORAGE_KEYS.tags] || [],
        notebooks: result[STORAGE_KEYS.notebooks] || {},
        notebookNames: result[STORAGE_KEYS.notebookNames] || {},
        settings: result[STORAGE_KEYS.settings] || { removeEmoji: false, enlargeText: false }
      });
    });
  });
}

async function setTags(tags) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEYS.tags]: tags }, () => {
      resolve({ success: true });
    });
  });
}

async function setNotebooks(notebooks) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEYS.notebooks]: notebooks }, () => {
      resolve({ success: true });
    });
  });
}

async function setNotebookNames(notebookNames) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEYS.notebookNames]: notebookNames }, () => {
      resolve({ success: true });
    });
  });
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.settings], (result) => {
      resolve(result[STORAGE_KEYS.settings] || { removeEmoji: false, enlargeText: false });
    });
  });
}

async function setSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEYS.settings]: settings }, () => {
      // Notify content scripts to apply settings
      chrome.tabs.query({ url: 'https://notebooklm.google.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'applySettings', settings }).catch(() => {});
        });
      });
      resolve({ success: true });
    });
  });
}

async function exportData() {
  const data = await getData();
  const exportObj = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    ...data
  };
  return {
    success: true,
    data: JSON.stringify(exportObj, null, 2)
  };
}

async function importData(importedData) {
  try {
    // Parse if it's a string
    if (typeof importedData === 'string') {
      try {
        importedData = JSON.parse(importedData);
      } catch (e) {
        return { success: false, error: 'Invalid JSON format' };
      }
    }
    
    if (!importedData || typeof importedData !== 'object') {
      return { success: false, error: 'Invalid data format' };
    }
    
    const tags = Array.isArray(importedData.tags) ? importedData.tags : [];
    const notebooks = typeof importedData.notebooks === 'object' ? importedData.notebooks : {};
    const notebookNames = typeof importedData.notebookNames === 'object' ? importedData.notebookNames : {};
    
    // Validate tags are strings
    const validTags = tags.filter(t => typeof t === 'string' && t.trim());
    
    // Validate notebooks structure
    const validNotebooks = {};
    for (const [id, notebookTags] of Object.entries(notebooks)) {
      if (Array.isArray(notebookTags)) {
        validNotebooks[id] = notebookTags.filter(t => validTags.includes(t));
      }
    }
    
    // Validate notebook names
    const validNotebookNames = {};
    for (const [id, name] of Object.entries(notebookNames)) {
      if (typeof name === 'string') {
        validNotebookNames[id] = name;
      }
    }
    
    await chrome.storage.sync.set({
      [STORAGE_KEYS.tags]: validTags,
      [STORAGE_KEYS.notebooks]: validNotebooks,
      [STORAGE_KEYS.notebookNames]: validNotebookNames
    });
    
    // Notify content scripts to refresh
    chrome.tabs.query({ url: 'https://notebooklm.google.com/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'refresh' }).catch(() => {});
      });
    });
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function clearData() {
  return new Promise((resolve) => {
    chrome.storage.sync.set({
      [STORAGE_KEYS.tags]: [],
      [STORAGE_KEYS.notebooks]: {},
      [STORAGE_KEYS.notebookNames]: {}
    }, () => {
      // Notify content scripts to refresh
      chrome.tabs.query({ url: 'https://notebooklm.google.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'refresh' }).catch(() => {});
        });
      });
      resolve({ success: true });
    });
  });
}

// Listen for storage changes and sync across tabs
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    console.log('[NLM Organizer] Storage changed:', Object.keys(changes));
  }
});
