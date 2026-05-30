// Initialize options page when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  // Apply translations to all elements with data-i18n attribute
  await translateElements();
  
  // Set up tab navigation
  setupTabs();
  
  // Set up accordion functionality
  setupAccordion();
  
  // Load saved titles
  await loadSavedTitles();
  
  // Load default options
  await loadDefaultOptions();
  
  // Set up event listeners for buttons
  setupEventListeners();
  
  // Set up language selector
  setupLanguageSelector();
  
  // Set up regex template picker
  setupRegexTemplates();
  
  // Listen for language change messages
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.action === 'refreshLanguage') {
      window.location.reload();
    }
  });
});

// Generate a unique ID for a rule based on current time (YYMMDD-HHmmss)
function generateRuleId() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yy}${mm}${dd}-${hh}${min}${ss}`;
}

// Apply translations to all elements with data-i18n attribute
async function translateElements() {
  const elements = document.querySelectorAll('[data-i18n]');
  const keys = Array.from(elements).map(el => el.getAttribute('data-i18n'));
  
  // Batch fetch all translations in a single message
  const messages = await new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'batchGetTranslatedMessages',
      keys: keys
    }, (response) => {
      resolve(response && response.messages ? response.messages : {});
    });
  });
  
  elements.forEach(element => {
    const key = element.getAttribute('data-i18n');
    if (messages[key]) {
      element.textContent = messages[key];
    }
  });
}

// Get translated message from background script
async function getTranslatedMessage(messageName, substitutions) {
  return new Promise((resolve) => {
    // First try our custom translation system
    chrome.runtime.sendMessage({
      action: 'getTranslatedMessage',
      messageName: messageName,
      substitutions: substitutions
    }, (response) => {
      if (response && response.message) {
        resolve(response.message);
      } else {
        // Fall back to Chrome's built-in i18n if our system doesn't have the translation
        resolve(chrome.i18n.getMessage(messageName, substitutions));
      }
    });
  });
}

// Set up tab navigation
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons and contents
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // Add active class to clicked button and corresponding content
      button.classList.add('active');
      const tabId = button.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
    });
  });
}

// Set up accordion functionality
function setupAccordion() {
  const accordionHeaders = document.querySelectorAll('.accordion-header');
  
  accordionHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const accordionItem = header.parentElement;
      accordionItem.classList.toggle('active');
      
      // Close other accordion items
      const siblings = Array.from(accordionItem.parentElement.children).filter(item => item !== accordionItem);
      siblings.forEach(sibling => sibling.classList.remove('active'));
    });
  });
}

// Load saved titles
async function loadSavedTitles() {
  const titleList = document.querySelector('.title-list');
  titleList.innerHTML = ''; // Clear existing items
  
  const data = await chrome.storage.sync.get();
  
  // Sort keys by id primarily, missing ids go to the end
  const keys = Object.keys(data).sort((a, b) => {
    // Put options and userLanguage at the end
    if (a === 'options' || a === 'userLanguage') return 1;
    if (b === 'options' || b === 'userLanguage') return -1;
    
    const valA = data[a];
    const valB = data[b];
    const idA = (valA && valA.id) ? valA.id : "";
    const idB = (valB && valB.id) ? valB.id : "";
    
    // Sort by id descending (newest first)
    if (idA && idB) return idB.localeCompare(idA);
    if (idA && !idB) return -1;
    if (!idA && idB) return 1;
    
    // Fallback sort by type
    const aIsDomain = a.startsWith('*');
    const bIsDomain = b.startsWith('*');
    const aIsTabLock = a.startsWith('Tab#');
    const bIsTabLock = b.startsWith('Tab#');
    
    if (aIsDomain && !bIsDomain) return -1;
    if (!aIsDomain && bIsDomain) return 1;
    if (aIsTabLock && !bIsTabLock) return 1;
    if (!aIsTabLock && bIsTabLock) return -1;
    
    return a.localeCompare(b);
  });
  
  // Create list items for each saved title
  for (const key of keys) {
    // Skip options and userLanguage
    if (key === 'options' || key === 'userLanguage') continue;
    
    const value = data[key];
    // Skip if value is not an object with title property
    if (!value || typeof value !== 'object' || !value.title) continue;
    
    // Create title item
    const item = document.createElement('div');
    item.className = 'title-item';
    item.dataset.key = key;
    
    // Create header container for ID and actions
    const headerContainer = document.createElement('div');
    headerContainer.className = 'title-header';
    
    // Create ID container
    const idContainer = document.createElement('div');
    if (value.id) {
      const idDisplay = document.createElement('span');
      idDisplay.className = 'rule-id-display';
      idDisplay.textContent = `[${value.id}]`;
      idDisplay.title = 'Edit ID';
      idDisplay.style.color = '#0066cc';
      idDisplay.style.fontWeight = 'bold';
      idDisplay.style.fontSize = '12px';
      idDisplay.style.cursor = 'pointer';
      idDisplay.addEventListener('click', () => editRuleId(key, value));
      idContainer.appendChild(idDisplay);
    }
    
    // Create actions (edit, delete)
    const actions = document.createElement('div');
    actions.className = 'title-actions';
    
    const editButton = document.createElement('button');
    editButton.className = 'edit-button';
    editButton.textContent = '✏️';
    editButton.title = 'Edit Title';
    
    const saveButton = document.createElement('button');
    saveButton.className = 'save-button';
    saveButton.textContent = '💾';
    saveButton.title = 'Save';
    saveButton.style.display = 'none';
    
    const cancelButton = document.createElement('button');
    cancelButton.className = 'cancel-button';
    cancelButton.textContent = '❌';
    cancelButton.title = 'Cancel';
    cancelButton.style.display = 'none';
    
    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-button';
    deleteButton.textContent = '🗑️';
    deleteButton.title = 'Delete';
    deleteButton.addEventListener('click', () => deleteTitle(key));
    
    actions.appendChild(editButton);
    actions.appendChild(saveButton);
    actions.appendChild(cancelButton);
    actions.appendChild(deleteButton);
    
    headerContainer.appendChild(idContainer);
    headerContainer.appendChild(actions);
    
    // Create title info (read mode)
    const titleInfo = document.createElement('div');
    titleInfo.className = 'title-info';
    
    const titleUrl = document.createElement('div');
    titleUrl.className = 'title-url';
    titleUrl.textContent = formatKey(key);
    
    const titleText = document.createElement('div');
    titleText.className = 'title-text';
    titleText.textContent = value.title;
    
    titleInfo.appendChild(titleUrl);
    titleInfo.appendChild(titleText);
    
    // Create edit info (edit mode)
    const editInfo = document.createElement('div');
    editInfo.className = 'edit-info';
    editInfo.style.display = 'none';
    editInfo.style.flexDirection = 'column';
    editInfo.style.gap = '8px';
    editInfo.style.width = '100%';
    
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.value = key;
    urlInput.className = 'edit-url-input';
    urlInput.placeholder = 'Pattern or URL';
    
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = value.title;
    titleInput.className = 'edit-title-input';
    titleInput.placeholder = 'Title';
    
    editInfo.appendChild(urlInput);
    editInfo.appendChild(titleInput);
    
    // Edit action logic
    editButton.addEventListener('click', () => {
      titleInfo.style.display = 'none';
      editInfo.style.display = 'flex';
      editButton.style.display = 'none';
      deleteButton.style.display = 'none';
      saveButton.style.display = 'inline-block';
      cancelButton.style.display = 'inline-block';
      titleInput.focus();
    });
    
    cancelButton.addEventListener('click', () => {
      titleInfo.style.display = 'block';
      editInfo.style.display = 'none';
      editButton.style.display = 'inline-block';
      deleteButton.style.display = 'inline-block';
      saveButton.style.display = 'none';
      cancelButton.style.display = 'none';
      urlInput.value = key;
      titleInput.value = value.title;
    });
    
    saveButton.addEventListener('click', () => {
      const newKey = urlInput.value.trim();
      const newTitle = titleInput.value.trim();
      
      if (!newKey || !newTitle) {
        alert('Pattern and Title cannot be empty.');
        return;
      }
      
      if (newKey === key && newTitle === value.title) {
        cancelButton.click();
        return;
      }
      
      if (newKey === key) {
        const update = {};
        update[key] = { title: newTitle };
        if (value.id) update[key].id = value.id;
        chrome.storage.sync.set(update, () => loadSavedTitles());
      } else {
        const update = {};
        update[newKey] = { title: newTitle };
        if (value.id) update[newKey].id = value.id;
        chrome.storage.sync.remove(key, () => {
          chrome.storage.sync.set(update, () => loadSavedTitles());
        });
      }
    });
    
    // Add everything to the item
    item.appendChild(headerContainer);
    item.appendChild(titleInfo);
    item.appendChild(editInfo);
    
    // Add item to the list
    titleList.appendChild(item);
  }
  
  // Show a message if no titles are saved
  if (titleList.children.length === 0) {
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'empty-message';
    emptyMessage.textContent = 'No saved titles yet.';
    titleList.appendChild(emptyMessage);
  }
}

// Format key for display
function formatKey(key) {
  if (key.startsWith('Tab#')) {
    return `Tab #${key.substring(4)}`;
  } else if (key.startsWith('*') && key.endsWith('*')) {
    return `Pattern: ${key.substring(1, key.length - 1)}`;
  } else if (key.endsWith('*') && !key.startsWith('*')) {
    return `Prefix: ${key.substring(0, key.length - 1)}`;
  } else {
    return `URL: ${key}`;
  }
}



// Edit a rule ID
function editRuleId(key, value) {
  const newId = prompt('Enter new rule ID:', value.id || '');
  
  if (newId !== null && newId !== value.id) {
    const update = {};
    update[key] = { title: value.title, id: newId };
    
    chrome.storage.sync.set(update, () => {
      if (chrome.runtime.lastError) {
        console.error('Error saving rule ID:', chrome.runtime.lastError);
        alert('Error saving rule ID: ' + chrome.runtime.lastError.message);
        return;
      }
      loadSavedTitles(); // Reload the list
    });
  }
}

// Delete a title
function deleteTitle(key) {
  if (confirm('Are you sure you want to delete this title rule?')) {
    chrome.storage.sync.remove(key, () => {
      if (chrome.runtime.lastError) {
        console.error('Error deleting title:', chrome.runtime.lastError);
        alert('Error deleting title: ' + chrome.runtime.lastError.message);
        return;
      }
      loadSavedTitles(); // Reload the list
    });
  }
}

// Load default options
async function loadDefaultOptions() {
  const data = await chrome.storage.sync.get('options');
  const options = data.options || {};
  
  const defaultOption = options.defaultOption || 'onetime';
  
  // Set radio buttons based on stored options
  const radio = document.querySelector(`input[name="defaultOption"][value="${defaultOption}"]`);
  if (radio) {
    radio.checked = true;
  } else {
    // Default to 'onetime' if no option is set or found
    const fallback = document.querySelector('input[name="defaultOption"][value="onetime"]');
    if (fallback) fallback.checked = true;
  }
}

// Set up event listeners
function setupEventListeners() {
  // Save default options
  document.getElementById('saveDefaultOptions').addEventListener('click', saveDefaultOptions);
  
  // Add URL pattern
  document.getElementById('addPattern').addEventListener('click', addUrlPattern);
  
  // Edit shortcuts
  document.getElementById('editShortcuts').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  
  // Export settings
  document.getElementById('exportSettings').addEventListener('click', exportSettings);
  
  // Import settings
  document.getElementById('importFile').addEventListener('change', importSettings);
  
  // URL pattern validation
  const urlPatternInput = document.getElementById('urlPattern');
  urlPatternInput.addEventListener('input', () => {
    const isValid = /^\*.*\*$/.test(urlPatternInput.value.trim());
    
    if (isValid) {
      urlPatternInput.classList.add('valid');
      urlPatternInput.classList.remove('invalid');
    } else {
      urlPatternInput.classList.add('invalid');
      urlPatternInput.classList.remove('valid');
    }
  });
  
  // Enter key handlers for URL pattern form
  urlPatternInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      document.getElementById('patternTitle').focus();
      e.preventDefault();
    }
  });
  
  document.getElementById('patternTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      addUrlPattern();
      e.preventDefault();
    }
  });
}

// Save default options
async function saveDefaultOptions() {
  const selectedOption = document.querySelector('input[name="defaultOption"]:checked');
  const defaultOption = selectedOption ? selectedOption.value : 'onetime';
  
  // Merge with existing options to preserve language and other settings
  const data = await chrome.storage.sync.get('options');
  const options = data.options || {};
  options.defaultOption = defaultOption;
  
  chrome.storage.sync.set({ options }, () => {
    // Show success feedback
    const saveButton = document.getElementById('saveDefaultOptions');
    const originalText = saveButton.textContent;
    
    saveButton.textContent = '✓ Saved';
    saveButton.classList.add('success');
    
    setTimeout(() => {
      saveButton.textContent = originalText;
      saveButton.classList.remove('success');
    }, 2000);
  });
}

// Add URL pattern
function addUrlPattern() {
  const urlPattern = document.getElementById('urlPattern').value.trim();
  const patternTitle = document.getElementById('patternTitle').value;
  
  if (!/^\*.*\*$/.test(urlPattern)) {
    document.getElementById('urlPattern').classList.add('invalid');
    document.getElementById('urlPattern').focus();
    return;
  }
  
  const update = {};
  update[urlPattern] = { title: patternTitle, id: generateRuleId() };
  
  chrome.storage.sync.set(update, () => {
    // Clear inputs
    document.getElementById('urlPattern').value = '';
    document.getElementById('patternTitle').value = '';
    
    // Show success feedback
    const addButton = document.getElementById('addPattern');
    const originalText = addButton.textContent;
    
    addButton.textContent = '✓ Added';
    addButton.classList.add('success');
    
    setTimeout(() => {
      addButton.textContent = originalText;
      addButton.classList.remove('success');
    }, 2000);
    
    // Reload saved titles
    loadSavedTitles();
  });
}

// Export settings
function exportSettings() {
  chrome.storage.sync.get(null, (data) => {
    // Convert the data to a JSON string
    const jsonString = JSON.stringify(data, null, 2);
    
    // Create a blob with the JSON data
    const blob = new Blob([jsonString], { type: 'application/json' });
    
    // Create a URL for the blob
    const url = URL.createObjectURL(blob);
    
    // Create a temporary link element
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tab-retitler-settings.json';
    
    // Append the link to the body, click it, and remove it
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Release the blob URL
    URL.revokeObjectURL(url);
  });
}

// Import settings
function importSettings(event) {
  const file = event.target.files[0];
  
  if (!file) return;
  
  const reader = new FileReader();
  
  reader.onload = (e) => {
    try {
      let data = JSON.parse(e.target.result);
      
      // Validate structure
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        alert('Error importing settings: Invalid settings format');
        return;
      }
      
      // Handle new export format with metadata wrapper
      if (data.metadata && data.settings) {
        data = data.settings;
      }
      
      // Confirm import
      if (confirm('This will replace your current settings. Continue?')) {
        // Clear existing settings first
        chrome.storage.sync.clear(() => {
          // Set the imported settings
          chrome.storage.sync.set(data, () => {
            // Reload the page to show the imported settings
            window.location.reload();
          });
        });
      }
    } catch (error) {
      alert('Error importing settings: ' + error.message);
    }
  };
  
  reader.readAsText(file);
}

// Set up language selector
function setupLanguageSelector() {
  const languageSelect = document.getElementById('language');
  
  // Get current language from storage
  chrome.runtime.sendMessage({ action: 'getLanguage' }, (response) => {
    if (response && response.language) {
      // Set language selector to current language
      if (languageSelect.querySelector(`option[value="${response.language}"]`)) {
        languageSelect.value = response.language;
      }
    }
  });
  
  // Add change handler
  languageSelect.addEventListener('change', () => {
    const selectedLanguage = languageSelect.value;
    
    // Store the language preference in options
    chrome.storage.sync.get('options', (data) => {
      const options = data.options || {};
      options.language = selectedLanguage;
      
      chrome.storage.sync.set({ options }, () => {
        // Notify the background script to change the language
        chrome.runtime.sendMessage({ action: 'changeLanguage' }, async (response) => {
          if (response && response.success) {
            // Show success message - use custom translation if available
            const successMessage = document.createElement('div');
            successMessage.className = 'language-success';
            
            // Try to get translated message, or fall back to English
            let message = await getTranslatedMessage("languageChangeSuccess");
            if (!message) {
              message = 'Language preference saved. Reloading...';
            }
            
            successMessage.textContent = message;
            
            // Insert after language selector
            const languageContainer = languageSelect.parentElement;
            languageContainer.appendChild(successMessage);
            
            // Reload the page after a short delay
            setTimeout(() => {
              window.location.reload();
            }, 1000);
          }
        });
      });
    });
  });
}

// Regex template library - ready-made patterns for common use cases
const REGEX_TEMPLATES = [
  { id: 'remove_suffix_dash', pattern: '/(.*?)\\s*[-–—]\\s*[^-–—]+$/$1/g', nameKey: 'regexTemplateRemoveSuffix' },
  { id: 'remove_suffix_pipe', pattern: '/(.*?)\\s*\\|\\s*[^|]+$/$1/g', nameKey: 'regexTemplateRemovePipe' },
  { id: 'remove_brackets', pattern: '/\\s*[\\(\\[].*?[\\)\\]]\\s*//g', nameKey: 'regexTemplateRemoveBrackets' },
  { id: 'add_prefix', pattern: '/^(.*)$/🔖 $1/', nameKey: 'regexTemplateAddPrefix' },
  { id: 'add_suffix', pattern: '/^(.*)$/$1 ⭐/', nameKey: 'regexTemplateAddSuffix' },
  { id: 'uppercase', pattern: '/^(.*)$/$1/i', nameKey: 'regexTemplateUppercase' },
  { id: 'clean_whitespace', pattern: '/\\s{2,}/ /g', nameKey: 'regexTemplateCleanWhitespace' }
];

// Set up regex template picker in the accordion
function setupRegexTemplates() {
  const templateList = document.getElementById('regexTemplateList');
  if (!templateList) return;

  REGEX_TEMPLATES.forEach(template => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'regex-template-btn';

    // Try translated name, fall back to key
    getTranslatedMessage(template.nameKey).then(msg => {
      btn.textContent = msg || template.nameKey;
    });

    btn.addEventListener('click', () => {
      // Copy pattern to clipboard and show feedback
      navigator.clipboard.writeText(template.pattern).then(() => {
        const original = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.classList.add('success');
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('success');
        }, 1500);
      }).catch(() => {
        // Fallback: select pattern text for manual copy
        prompt('Copy this regex pattern:', template.pattern);
      });
    });

    templateList.appendChild(btn);
  });
}