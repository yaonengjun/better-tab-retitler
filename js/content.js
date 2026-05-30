// Observe title changes and notify the background script

// Keep track of the last title to avoid unnecessary notifications
let lastTitle = document.title;

// Store observer references for cleanup
let titleObserver = null;
let headObserver = null;

// High-frequency title lock variables
let lockedTitle = null;
let titleLockTimeout = null;

// Modern cleanup management
let isCleanedUp = false;
let extensionController = null;

// Function to observe title changes
function observeTitleChanges() {
  // Clean up existing observers directly to prevent memory leaks and observer explosion
  if (titleObserver) { titleObserver.disconnect(); }
  if (headObserver) { headObserver.disconnect(); }
  
  // Get the title element
  let titleElement = document.querySelector('title');
  
  // If title element doesn't exist, create one
  if (!titleElement) {
    titleElement = document.createElement('title');
    titleElement.textContent = document.title || window.location.href;
    document.head.appendChild(titleElement);
  }
  
  // Create a mutation observer to watch for title changes
  titleObserver = new MutationObserver((mutations) => {
    // If the title is locked by the user, forcefully revert any unauthorized changes
    if (lockedTitle !== null) {
      if (document.title !== lockedTitle) {
        // Debounce the lock reversion to avoid infinite microtask loops with aggressive SPAs
        if (titleLockTimeout) clearTimeout(titleLockTimeout);
        titleLockTimeout = setTimeout(() => {
          if (document.title !== lockedTitle) {
            document.title = lockedTitle;
            lastTitle = lockedTitle;
          }
        }, 10);
      }
      return; // Do not notify background, handle it locally
    }

    // Only notify if the title has actually changed
    if (document.title !== lastTitle) {
      lastTitle = document.title;
      notifyTitleChange();
    }
  });
  
  // Start observing the title element
  titleObserver.observe(titleElement, {
    subtree: true,
    characterData: true,
    childList: true
  });
  
  // Also observe the head element for title additions/removals
  headObserver = new MutationObserver((mutations) => {
    let titleChanged = false;
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        // Check if title element was added or removed
        const addedTitle = Array.from(mutation.addedNodes).some(n => n.nodeName && n.nodeName.toLowerCase() === 'title');
        const removedTitle = Array.from(mutation.removedNodes).some(n => n.nodeName && n.nodeName.toLowerCase() === 'title');
        
        if (addedTitle || removedTitle) {
          titleChanged = true;
        }
      }
    });
    
    if (titleChanged) {
      // Title was added or removed, restart observation
      observeTitleChanges();
      
      // If we have a locked title, re-apply it safely
      if (lockedTitle !== null && document.title !== lockedTitle) {
        if (titleLockTimeout) clearTimeout(titleLockTimeout);
        titleLockTimeout = setTimeout(() => {
          if (document.title !== lockedTitle) {
            document.title = lockedTitle;
            lastTitle = lockedTitle;
          }
        }, 10);
      }
    }
  });
  
  headObserver.observe(document.head, {
    childList: true
  });
}

// Safe wrapper for chrome.runtime.sendMessage to avoid errors when extension context is invalidated
function safeSendMessage(message) {
  try {
    if (chrome && chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage(message);
    }
  } catch (e) {
    // Ignore errors such as "Extension context invalidated"
    // This can happen if the extension is reloaded while the content script is still running
    console.warn('safeSendMessage ignored an error:', e);
  }
}

// Notify the background script about title changes
function notifyTitleChange() {
  safeSendMessage({
    action: "titleChanged",
    title: document.title,
    url: window.location.href
  });
}

// Set a new title
function setTitle(title) {
  lockedTitle = title;
  document.documentElement.dataset.tabRetitlerLock = title; // Signal to MAIN world hijacker
  document.title = title;
  lastTitle = title;
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'getTitle':
      sendResponse({ title: document.title });
      break;
      
    case 'setTitle':
      setTitle(message.title);
      sendResponse({ success: true });
      break;
      
    case 'clearTitleLock':
      lockedTitle = null;
      delete document.documentElement.dataset.tabRetitlerLock;
      document.dispatchEvent(new CustomEvent('TabRetitlerUnlock')); // Notify MAIN world
      sendResponse({ success: true });
      break;
  }
  
  return true; // Indicate we'll respond asynchronously
});

// When the page loads, check if we need to update the title
function checkTitleOnLoad() {
  // Notify the background script about the initial title
  safeSendMessage({
    action: "checkTitle",
    title: document.title,
    url: window.location.href
  });
}

// Start observing title changes
observeTitleChanges();

// Check title on page load
checkTitleOnLoad();

// Re-check title when the page is fully loaded
window.addEventListener('load', () => {
  // Wait a short time to ensure any JavaScript on the page has had a chance to set the title
  setTimeout(checkTitleOnLoad, 500);
});

// ===== MODERN CSP-SAFE EVENT HANDLING =====

// Modern cleanup function with enhanced safety
function cleanupObservers() {
  if (isCleanedUp) return; // Prevent multiple cleanups
  
  isCleanedUp = true;
  
  if (titleObserver) {
    titleObserver.disconnect();
    titleObserver = null;
  }
  if (headObserver) {
    headObserver.disconnect();
    headObserver = null;
  }
  
  if (titleLockTimeout) {
    clearTimeout(titleLockTimeout);
    titleLockTimeout = null;
  }
  
  // Cleanup extension controller if exists
  if (extensionController) {
    extensionController.abort();
    extensionController = null;
  }
}

// Setup modern event listeners with CSP compliance
function setupSafeEventListeners() {
  // Use AbortController for clean event cleanup
  extensionController = new AbortController();
  const { signal } = extensionController;
  
  // Page Visibility API (CSP-safe and modern)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      cleanupObservers();
    } else if (document.visibilityState === 'visible' && isCleanedUp) {
      // Restart observers when page becomes visible again
      isCleanedUp = false;
      observeTitleChanges();
    }
  }, { signal });

  // pagehide event (more reliable than unload)
  window.addEventListener('pagehide', () => {
    cleanupObservers();
  }, { signal });

  // Optional: beforeunload with error handling for sites that allow it
  try {
    window.addEventListener('beforeunload', () => {
      cleanupObservers();
    }, { signal });
  } catch (e) {
    console.info('Tab ReTitler: beforeunload not supported on this site (CSP restriction)');
  }
}

// Initialize safe event listeners
setupSafeEventListeners();