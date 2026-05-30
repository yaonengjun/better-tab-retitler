// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  // Apply translations to all elements with data-i18n attribute
  translateElements();
  
  // Get current tab information
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const titleInput = document.getElementById('titleInput');
  const originalTitle = document.getElementById('originalTitle');
  
  // Check for matched rule
  chrome.runtime.sendMessage({
    action: 'getMatchedRule',
    tabId: tab.id,
    url: tab.url
  }, (response) => {
    if (response && response.success && response.matchedRule && response.matchedRule.id) {
      const matchedRuleInfo = document.getElementById('matchedRuleInfo');
      if (matchedRuleInfo) {
        getTranslatedMessage("labelMatchedRule", [response.matchedRule.id]).then(message => {
          matchedRuleInfo.textContent = message || `当前命中规则: [${response.matchedRule.id}]`;
          matchedRuleInfo.style.display = 'block';
        });
      }
    }
  });
  
  // Load default options
  loadDefaultOption(tab);
  
  // Set current title in input field
  titleInput.value = tab.title;
  
  // Set original title text with custom translation
  getTranslatedMessage("labelOriginalTitle", [tab.title]).then(message => {
    originalTitle.textContent = message;
  });
  
  // Add click handler to original title to restore it
  originalTitle.addEventListener('click', () => {
    titleInput.value = tab.title;
    titleInput.focus();
    titleInput.select();
  });
  
  // Check if there's a bookmark for this URL
  if (chrome.bookmarks) {
    loadBookmarkTitle(tab.url);
  }
  
  // Add click handler to set title button
  document.getElementById('setButton').addEventListener('click', () => {
    setTitle(tab);
  });
  
  // Add click handler to options button
  document.getElementById('optionsButton').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
  
  // Add enter key handler
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      setTitle(tab);
      e.preventDefault();
    }
  });
  
  // Focus and select the title input
  titleInput.focus();
  titleInput.select();
  
  // Handle radio button changes for dynamic input
  const radioButtons = document.querySelectorAll('input[name="titleType"]');
  radioButtons.forEach(radio => {
    radio.addEventListener('change', (e) => {
      updatePatternVisibility(e.target.value, tab);
    });
  });
  
  // Listen for language change messages
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.action === 'refreshLanguage') {
      // Re-translate all elements
      translateElements();
      
      // Update the original title message
      if (originalTitle && tab) {
        getTranslatedMessage("labelOriginalTitle", [tab.title]).then(message => {
          originalTitle.textContent = message;
        });
      }
    }
  });
  
  // Add escape key handler for better UX
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.close();
    }
  });
});

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

// Load default option from storage
async function loadDefaultOption(tab) {
  try {
    const data = await chrome.storage.sync.get('options');
    const options = data.options || {};
    
    // Get the default option or fallback to 'onetime'
    const defaultOption = options.defaultOption || 'onetime';
    
    // Set the appropriate radio button by value
    const radioElement = document.querySelector(`input[name="titleType"][value="${defaultOption}"]`);
    if (radioElement) {
      radioElement.checked = true;
      updatePatternVisibility(defaultOption, tab);
    } else {
      // Fallback to the first radio button if the element doesn't exist
      const firstRadio = document.querySelector('input[name="titleType"]');
      if (firstRadio) {
        firstRadio.checked = true;
        updatePatternVisibility(firstRadio.value, tab);
      }
    }
  } catch (error) {
    console.error("Error loading default option:", error);
    // Fallback to the first radio button
    const firstRadio = document.querySelector('input[name="titleType"]');
    if (firstRadio) {
      firstRadio.checked = true;
      if (tab) updatePatternVisibility(firstRadio.value, tab);
    }
  }
}

// Show or hide the pattern input based on selected type
function updatePatternVisibility(type, tab) {
  const patternInputGroup = document.getElementById('patternInputGroup');
  const patternInput = document.getElementById('patternInput');
  if (!patternInputGroup || !patternInput) return;

  if (type === 'keyword') {
    patternInputGroup.style.display = 'flex';
    if (!patternInput.dataset.keywordSet) {
      patternInput.value = '';
      patternInput.dataset.keywordSet = 'true';
    }
    getTranslatedMessage("placeholderKeywordPattern").then(message => {
      if (patternInput) patternInput.placeholder = message || "Multiple keywords supported, separate with |";
    });
  } else if (type === 'prefix') {
    patternInputGroup.style.display = 'flex';
    if (!patternInput.dataset.prefixSet && tab) {
      patternInput.value = tab.url;
      patternInput.dataset.prefixSet = 'true';
    }
    if (patternInput) patternInput.placeholder = "";
  } else {
    patternInputGroup.style.display = 'none';
  }
}

// Load bookmark title if available
async function loadBookmarkTitle(url) {
  try {
    // Check if bookmarks API is available
    if (!chrome.bookmarks || !chrome.bookmarks.search) {
      console.warn("Bookmarks API is not available");
      return;
    }
    
    const bookmarks = await chrome.bookmarks.search({ url });
    
    if (bookmarks && bookmarks.length > 0) {
      const bookmarkTitle = document.getElementById('bookmarkTitle');
      if (bookmarkTitle) {
        // Use custom translation
        const message = await getTranslatedMessage("labelBookmarkTitle", [bookmarks[0].title]);
        bookmarkTitle.textContent = message;
        
        // Add click handler to use bookmark title
        bookmarkTitle.addEventListener('click', () => {
          const titleInput = document.getElementById('titleInput');
          if (titleInput) {
            titleInput.value = bookmarks[0].title;
            titleInput.focus();
            titleInput.select();
          }
        });
        
        // Make it visible
        bookmarkTitle.style.display = 'block';
      }
    }
  } catch (e) {
    console.error("Error loading bookmark:", e);
  }
}

// Show message for restricted sites
function showRestrictedSiteMessage() {
  const titleInput = document.getElementById('titleInput');
  const container = titleInput.parentElement;
  
  // Create message element if it doesn't exist
  let messageEl = document.getElementById('restrictedMessage');
  if (!messageEl) {
    messageEl = document.createElement('div');
    messageEl.id = 'restrictedMessage';
    messageEl.style.cssText = `
      margin-top: 8px;
      padding: 12px;
      background-color: #fff3cd;
      border: 1px solid #ffeaa7;
      border-radius: 6px;
      font-size: 13px;
      color: #856404;
      line-height: 1.4;
      position: relative;
    `;
    
    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '×';
    closeBtn.style.cssText = `
      position: absolute;
      top: 4px;
      right: 4px;
      background: none;
      border: none;
      font-size: 16px;
      color: #856404;
      cursor: pointer;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    closeBtn.onclick = () => messageEl.style.display = 'none';
    closeBtn.onmouseover = () => closeBtn.style.backgroundColor = 'rgba(133, 100, 4, 0.1)';
    closeBtn.onmouseleave = () => closeBtn.style.backgroundColor = 'transparent';
    
    messageEl.appendChild(closeBtn);
    container.appendChild(messageEl);
  }
  
  // Set message text with icon
  Promise.all([
    getTranslatedMessage("restrictedSiteTitle"),
    getTranslatedMessage("restrictedSiteMessage")
  ]).then(([titleMessage, bodyMessage]) => {
    const closeBtn = messageEl.querySelector('button');
    
    const title = titleMessage || "Site Restriction";
    const body = bodyMessage || "This site doesn't allow extensions to modify page titles due to security restrictions (Chrome Web Store, browser pages, etc.).";
    
    messageEl.innerHTML = `
      <div style="padding-right: 24px;">
        <div style="display: flex; align-items: center; margin-bottom: 4px;">
          <span style="margin-right: 6px;">⚠️</span>
          <strong>${title}</strong>
        </div>
        <div>${body}</div>
      </div>
    `;
    
    // Re-add close button
    messageEl.appendChild(closeBtn);
    
    // Re-add close button events
    closeBtn.onclick = () => messageEl.style.display = 'none';
    closeBtn.onmouseover = () => closeBtn.style.backgroundColor = 'rgba(133, 100, 4, 0.1)';
    closeBtn.onmouseleave = () => closeBtn.style.backgroundColor = 'transparent';
  });
  
  // Show message
  messageEl.style.display = 'block';
  
  // Auto-hide after 10 seconds (much longer now)
  setTimeout(() => {
    if (messageEl && messageEl.style.display !== 'none') {
      messageEl.style.opacity = '0.7';
      messageEl.style.transition = 'opacity 0.5s ease-out';
    }
  }, 10000);
}

// Show error message
function showErrorMessage(errorText) {
  const titleInput = document.getElementById('titleInput');
  const container = titleInput.parentElement;
  
  // Remove existing error message
  const existingError = document.getElementById('errorMessage');
  if (existingError) {
    existingError.remove();
  }
  
  // Create error message element
  const errorEl = document.createElement('div');
  errorEl.id = 'errorMessage';
  errorEl.style.cssText = `
    margin-top: 8px;
    padding: 12px;
    background-color: #f8d7da;
    border: 1px solid #dc3545;
    border-radius: 6px;
    font-size: 13px;
    color: #721c24;
    line-height: 1.4;
  `;
  
  // Get localized title and use provided error text
  getTranslatedMessage("errorTitle").then(titleMessage => {
    const title = titleMessage || "Error";
    const body = errorText || 'An error occurred while setting the title';
    
    errorEl.innerHTML = `
      <div style="display: flex; align-items: center; margin-bottom: 4px;">
        <span style="margin-right: 6px;">❌</span>
        <strong>${title}</strong>
      </div>
      <div>${body}</div>
    `;
  });
  
  container.appendChild(errorEl);
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    if (errorEl) {
      errorEl.style.display = 'none';
    }
  }, 5000);
}

// Set the title based on user input
function setTitle(tab) {
  const titleInput = document.getElementById('titleInput');
  const setButton = document.getElementById('setButton');
  
  if (!titleInput || !setButton) return;
  
  const newTitle = titleInput.value;
  
  // Show enhanced loading state
  setButton.disabled = true;
  getTranslatedMessage("buttonLoading").then(text => {
    setButton.innerHTML = text || '⏳ Setting...';
  });
  setButton.classList.add('loading');
  
  // Disable input during loading
  titleInput.disabled = true;
  
  // Disable radio buttons during loading
  const radioButtons = document.querySelectorAll('input[name="titleType"]');
  radioButtons.forEach(radio => radio.disabled = true);
  
  // Get the selected persistence option
  const selectedOption = document.querySelector('input[name="titleType"]:checked');
  const type = selectedOption ? selectedOption.value : 'onetime';
  
  // Get custom pattern if applicable
  const patternInput = document.getElementById('patternInput');
  let patternValue = patternInput ? patternInput.value.trim() : '';
  
  if (type === 'keyword' && patternValue) {
    patternValue = patternValue.replace(/｜/g, '|');
  }
  
  if ((type === 'keyword' || type === 'prefix') && !patternValue) {
    showErrorMessage('Please enter a pattern');
    setButton.disabled = false;
    setButton.classList.remove('loading');
    titleInput.disabled = false;
    radioButtons.forEach(radio => radio.disabled = false);
    getTranslatedMessage("buttonSet").then(text => {
      setButton.innerHTML = text || 'Set Title';
    });
    return;
  }
  
  // Send message to background script
  chrome.runtime.sendMessage({
    action: "setTitle",
    tabId: tab.id,
    newTitle: newTitle,
    oldTitle: tab.title,
    type: type,
    url: tab.url,
    customPattern: patternValue
  }, (response) => {
    if (response && response.success) {
      // Show success state with better timing
      getTranslatedMessage("buttonSuccess").then(text => {
        setButton.innerHTML = text || '✓ Success!';
      });
      setButton.classList.add('success');
      
      setTimeout(() => {
        window.close();
      }, 1500); // Increased from 500ms to 1500ms
    } else if (response && response.restricted) {
      // Show restriction message for restricted sites
      getTranslatedMessage("buttonRestricted").then(text => {
        setButton.innerHTML = text || '⚠️ Site Restricted';
      });
      setButton.classList.add('warning');
      
      // Show explanation and keep popup open
      showRestrictedSiteMessage();
      
      // Reset button after showing message
      setTimeout(() => {
        setButton.disabled = false;
        getTranslatedMessage("buttonSet").then(text => {
          setButton.innerHTML = text || 'Set Title';
        });
        setButton.classList.remove('loading', 'warning');
        
        // Re-enable inputs
        titleInput.disabled = false;
        const radioButtons = document.querySelectorAll('input[name="titleType"]');
        radioButtons.forEach(radio => radio.disabled = false);
      }, 2000);
    } else {
      // Show error state with retry option
      getTranslatedMessage("buttonError").then(text => {
        setButton.innerHTML = text || '❌ Error Occurred';
      });
      setButton.classList.add('error');
      
      // Show error message
      showErrorMessage(response ? response.error : 'Unknown error');
      
      setTimeout(() => {
        setButton.disabled = false;
        getTranslatedMessage("buttonRetry").then(text => {
          setButton.innerHTML = text || 'Try Again';
        });
        setButton.classList.remove('loading', 'error');
        
        // Re-enable inputs
        titleInput.disabled = false;
        const radioButtons = document.querySelectorAll('input[name="titleType"]');
        radioButtons.forEach(radio => radio.disabled = false);
      }, 2000);
    }
  });
}