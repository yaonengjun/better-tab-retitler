// Regular expression for extracting domain from URL
const REGEX_DOMAIN = /https?:\/\/([^\s/]+)(?:$|\/.*)/; 
// Regex for validating regex patterns
const validRegex = /^\/((?:[^/]|\\\/)+)\/((?:[^/]|\\\/)+)\/(gi?|ig?)?$/;

// Constants
const CONSTANTS = {
  STORAGE: {
    QUOTA_LIMIT: 95000, // Leave buffer for Chrome's 100KB limit
    CLEANUP_BATCH_SIZE: 10
  },
  THROTTLE: {
    MESSAGE_DELAY: 100, // ms
    TITLE_CHANGE_TIMEOUT: 1000 // ms
  },
  VALIDATION: {
    MAX_TITLE_LENGTH: 500,
    MAX_URL_LENGTH: 2000,
    MAX_REGEX_LENGTH: 1000
  },
  REGEX_FLAGS: /^[gim]*$/
};

/**
 * Generate a unique ID for a rule based on current time (YYMMDD-HHmmss)
 */
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

/**
 * Convert a user-supplied glob pattern to a RegExp.
 * Rules:
 *   - All regex metacharacters except * are escaped as literals
 *   - * is converted to .* (matches any character sequence, including empty)
 *   - The result is fully anchored with ^ and $ so that prefix*, *sub* and
 *     prefix*suffix all work as expected
 *
 * Examples:
 *   globToRegex('https://example.com/path*') => /^https:\/\/example\.com\/path.*$/
 *   globToRegex('*foo.bar*')                 => /^.*foo\.bar.*$/
 *   globToRegex('*search*detail*')           => /^.*search.*detail.*$/
 */
function globToRegex(pattern) {
  // Escape all regex metacharacters except *
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // Replace * with .* (glob wildcard)
  const regexStr = escaped.replace(/\*/g, '.*');
  return new RegExp('^' + regexStr + '$');
}

// Security functions
function sanitizeTitle(title) {
  if (typeof title !== 'string') return '';
  
  // Limit length only - document.title is a plain text property (DOMString),
  // not parsed as HTML, so characters like & ' " are safe and should be preserved
  return title.substring(0, CONSTANTS.VALIDATION.MAX_TITLE_LENGTH);
}

function sanitizeUrl(url) {
  if (typeof url !== 'string') return '';
  
  try {
    // Validate URL format
    new URL(url);
    return url.substring(0, CONSTANTS.VALIDATION.MAX_URL_LENGTH);
  } catch (e) {
    console.info(`Tab ReTitler: Invalid URL format: ${url}`);
    return '';
  }
}

// Keep track of our own title changes to prevent loops
const ourTitleChanges = new Map();

// Modern tab capability tracking
const tabCapabilities = new Map();

// Tab capability test results
const TabCapability = {
  FULL_ACCESS: 'full_access',
  RESTRICTED: 'restricted', 
  UNKNOWN: 'unknown'
};

// In-memory rules cache to avoid reading full storage on every tab update
let rulesCache = null;

async function getRulesFromCache() {
  if (rulesCache === null) {
    rulesCache = await chrome.storage.sync.get();
  }
  return rulesCache;
}

// Invalidate cache when storage changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    rulesCache = null;
  }
});

// Message throttling to prevent excessive messaging
const messageThrottle = new Map();

function throttleMessage(key, callback) {
  const now = Date.now();
  const lastCall = messageThrottle.get(key) || 0;
  
  if (now - lastCall >= CONSTANTS.THROTTLE.MESSAGE_DELAY) {
    messageThrottle.set(key, now);
    callback();
  }
}

// Global translations object to store loaded translations
let translations = {};

// Load translations for a specific language
async function loadTranslations(language) {
  try {
    // Load the language file
    const url = chrome.runtime.getURL(`_locales/${language}/messages.json`);
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error(`Failed to load translations for ${language}:`, response.statusText);
      return false;
    }
    
    // Parse the JSON
    translations = await response.json();
    
    // Store loaded language
    chrome.storage.local.set({ 
      currentLanguage: language,
      translations: translations 
    });
    
    return true;
  } catch (error) {
    console.error(`Error loading translations for ${language}:`, error);
    return false;
  }
}

// Get a translated message, similar to chrome.i18n.getMessage
function getTranslatedMessage(messageName, substitutions) {
  // Check if we have the message
  if (!translations[messageName] || !translations[messageName].message) {
    return '';
  }
  
  let message = translations[messageName].message;
  
  // Process substitutions
  if (substitutions) {
    if (typeof substitutions === 'string') {
      message = message.replace(/\$1/g, substitutions);
    } else if (Array.isArray(substitutions)) {
      for (let i = 0; i < substitutions.length; i++) {
        const regex = new RegExp('\\$' + (i + 1), 'g');
        message = message.replace(regex, substitutions[i]);
      }
    }
  }
  
  return message;
}

// Set the extension language based on user preference or browser default
async function setExtensionLanguage() {
  const data = await chrome.storage.sync.get('options');
  const options = data.options || {};
  
  // Get user's preferred language or use browser default
  const userLanguage = options.language || chrome.i18n.getUILanguage().split('-')[0];
  
  // Load translations for the selected language
  const success = await loadTranslations(userLanguage);
  
  // If loading fails, try to load English as fallback
  if (!success && userLanguage !== 'en') {
    await loadTranslations('en');
  }
  
  // Broadcast a message to refresh the UI
  chrome.runtime.sendMessage({
    action: 'refreshLanguage',
    language: userLanguage
  }).catch(err => {
    // Ignore errors about no receivers
    console.log("Language refresh message sent");
  });
  
  return userLanguage;
}

// Process regex title replacement
function processRegexReplacement(pattern, oldTitle) {
  const captured = validRegex.exec(pattern);
  if (captured) {
    const regexPattern = captured[1];
    const replacement = captured[2];
    const flags = captured[3] || '';
    
    // Validate flags to prevent security issues
    if (!CONSTANTS.REGEX_FLAGS.test(flags)) {
      console.error("Invalid regex flags:", flags);
      return oldTitle + ' | Invalid Flags';
    }
    
    // Limit regex pattern length to prevent ReDoS attacks
    if (regexPattern.length > CONSTANTS.VALIDATION.MAX_REGEX_LENGTH) {
      console.error("Regex pattern too long");
      return oldTitle + ' | Pattern Too Long';
    }
    
    try {
      const regex = new RegExp(regexPattern, flags);
      return oldTitle.replace(regex, replacement);
    } catch (e) {
      console.error("Regex error:", e);
      return oldTitle + ' | Regex Error';
    }
  }
  return pattern;
}

// Process title template variables: {original}, {domain}, {url}, {date}, {time}
function processTitleTemplate(title, oldTitle, url) {
  if (!title.includes('{')) return title;

  const domainMatch = url ? url.match(REGEX_DOMAIN) : null;
  const domain = domainMatch ? domainMatch[1] : '';
  const now = new Date();

  return title
    .replace(/\{original\}/gi, oldTitle || '')
    .replace(/\{domain\}/gi, domain)
    .replace(/\{url\}/gi, url || '')
    .replace(/\{date\}/gi, now.toLocaleDateString())
    .replace(/\{time\}/gi, now.toLocaleTimeString());
}

// Process URL pattern replacement
function processUrlPatternReplacement(title, oldTitle, url, pattern) {
  if (!url || !pattern) return title;
  
  // Replace ${n} with $n for URL pattern capture groups
  let processedTitle = title.replace(/\$\{(\d+)\}/g, '$$$1');
  
  // Replace $0 with original title
  processedTitle = processedTitle.replace(/\$0/g, oldTitle);
  
  try {
    return url.replace(pattern, processedTitle);
  } catch (e) {
    console.error("URL pattern replacement error:", e);
    return title;
  }
}

// Modern update tab title with capability detection
async function updateTabTitle(tabId, newTitle, oldTitle) {
  // Sanitize inputs
  newTitle = sanitizeTitle(newTitle);
  oldTitle = sanitizeTitle(oldTitle);
  
  if (!newTitle) {
    console.error("Invalid title provided");
    return false;
  }
  
  // Process regex patterns
  if (newTitle.match(validRegex)) {
    newTitle = processRegexReplacement(newTitle, oldTitle);
  }
  
  // Replace $0 with original title if not already processed by regex
  if (!newTitle.match(validRegex)) {
    newTitle = newTitle.replace(/\$0/g, oldTitle);
  }
  
  try {
    // Get tab info
    const tab = await chrome.tabs.get(tabId);
    
    // Process title template variables
    newTitle = processTitleTemplate(newTitle, oldTitle, tab.url);
    
    // Use modern capability-based approach
    return await updateTabTitleWithFallback(tabId, newTitle, oldTitle, tab.url);
    
  } catch (e) {
    if (e.message.includes('No tab with id')) {
      console.info(`Tab ReTitler: Tab ${tabId} not found or closed`);
    } else {
      console.warn(`Tab ReTitler: Unexpected error for tab ${tabId}:`, e);
    }
    return false;
  }
}

// Check and update title based on rules
async function checkAndUpdateTitle(tabId, url, currentTitle) {
  // Sanitize inputs
  url = sanitizeUrl(url);
  currentTitle = sanitizeTitle(currentTitle);
  
  if (!url || !currentTitle) return false;
  
  const rules = await getRulesFromCache();
  let ruleMatched = false;
  let newTitleToSet = null;
  
  // 0. Tab lock has absolute highest priority
  const tabLockKey = `Tab#${tabId}`;
  if (rules[tabLockKey]) {
    newTitleToSet = rules[tabLockKey].title;
    ruleMatched = true;
  } else {
    // Collect all possible matches across all priority levels
    let matchDomain = null;
    let matchExact = null;
    let bestPrefixPattern = null;
    let bestPrefixRegex = null;
    let bestPrefixLength = -1;
    let keywordPattern = null;
    let keywordRegex = null;
    
    // Check Domain [P4]
    const domainMatch = url.match(REGEX_DOMAIN);
    if (domainMatch && rules[`*${domainMatch[1]}*`]) {
      matchDomain = rules[`*${domainMatch[1]}*`].title;
    }
    
    // Check Exact [P3]
    if (rules[url]) {
      matchExact = rules[url].title;
    }
    
    // Check Prefix [P2] and Keyword [P1]
    for (const pattern in rules) {
      if (pattern.startsWith('*Tab#') || pattern === 'options' || pattern === 'userLanguage') continue;
      
      // (Removed the skip condition for pure-domain keys so Keyword match can work)
      
      try {
        let isMatch = false;
        let matchedRegex = null;
        
        // Special handling for keyword patterns to support multiple keywords separated by |
        if (pattern.startsWith('*') && pattern.endsWith('*') && pattern.includes('|')) {
          const inner = pattern.slice(1, -1);
          const keywords = inner.split('|').map(k => k.trim()).filter(k => k);
          if (keywords.length > 0) {
            isMatch = keywords.every(k => {
              const regex = globToRegex(`*${k}*`);
              if (regex.test(url)) {
                matchedRegex = regex;
                return true;
              }
              return false;
            });
          } else {
            isMatch = false;
          }
        } else {
          const regex = globToRegex(pattern);
          if (regex.test(url)) {
            matchedRegex = regex;
            isMatch = true;
          }
        }

        if (isMatch) {
          // Priority P2: Prefix Match
          if (pattern.endsWith('*') && !pattern.startsWith('*')) {
            const prefixLen = pattern.length - 1;
            if (prefixLen > bestPrefixLength) {
              bestPrefixLength = prefixLen;
              bestPrefixPattern = pattern;
              bestPrefixRegex = matchedRegex;
            }
          } 
          // Priority P1: Keyword Match
          else if (pattern.startsWith('*') && pattern.endsWith('*')) {
            if (!keywordPattern) {
              keywordPattern = pattern;
              keywordRegex = matchedRegex;
            }
          }
          // Fallback treating other globs as P1 Keyword match
          else if (!keywordPattern) {
            keywordPattern = pattern;
            keywordRegex = matchedRegex;
          }
        }
      } catch (e) {
        console.error("URL pattern matching error:", e);
      }
    }
    
    // Apply based on correct priority: Domain [P4] > Exact [P3] > Prefix [P2] > Keyword [P1]
    if (matchDomain) {
      newTitleToSet = matchDomain;
      ruleMatched = true;
    } else if (matchExact) {
      newTitleToSet = matchExact;
      ruleMatched = true;
    } else if (bestPrefixPattern) {
      newTitleToSet = processUrlPatternReplacement(rules[bestPrefixPattern].title, currentTitle, url, bestPrefixRegex || globToRegex(bestPrefixPattern));
      ruleMatched = true;
    } else if (keywordPattern) {
      newTitleToSet = processUrlPatternReplacement(rules[keywordPattern].title, currentTitle, url, keywordRegex || globToRegex(keywordPattern));
      ruleMatched = true;
    }
  }
  
  if (ruleMatched && newTitleToSet) {
    if (newTitleToSet !== currentTitle) {
      return await updateTabTitle(tabId, newTitleToSet, currentTitle);
    }
    return false;
  } else {
    // No rules matched for this URL, ensure any previous lock is cleared
    try {
      chrome.tabs.sendMessage(tabId, { action: 'clearTitleLock' }).catch(() => {});
    } catch (e) {}
    return false;
  }
}

// Save title rule
async function saveTitle(tabId, url, title, type, customPattern) {
  let obj = {};
  
  // Generate ID for persistent rules
  const ruleId = generateRuleId();
  
  switch (type) {
    case 'tablock':
      obj[`Tab#${tabId}`] = { title }; // No ID for tablock
      break;
    case 'exact':
      obj[url] = { title, id: ruleId };
      break;
    case 'domain':
      const domainMatch = url.match(REGEX_DOMAIN);
      if (domainMatch) {
        obj[`*${domainMatch[1]}*`] = { title, id: ruleId };
      }
      break;
    case 'keyword':
      if (customPattern) {
        obj[`*${customPattern}*`] = { title, id: ruleId };
      }
      break;
    case 'prefix':
      if (customPattern) {
        // Ensure it ends with * and doesn't start with *
        let prefix = customPattern.replace(/\*+$/, '');
        obj[`${prefix}*`] = { title, id: ruleId };
      }
      break;
    case 'onetime':
    default:
      // No storage needed for one-time changes
      return;
  }
  
  if (Object.keys(obj).length === 0) return;
  
  
  try {
    // Check storage quota before saving
    const currentData = await chrome.storage.sync.get();
    const currentSize = JSON.stringify(currentData).length;
    const newSize = JSON.stringify(obj).length;
    
    // Chrome sync storage limit is ~100KB
    if (currentSize + newSize > CONSTANTS.STORAGE.QUOTA_LIMIT) { // Leave some buffer
      console.warn('Storage quota approaching limit, cleaning old entries');
      await cleanOldEntries();
    }
    
    await chrome.storage.sync.set(obj);
  } catch (error) {
    if (error.message.includes('QUOTA_EXCEEDED')) {
      console.error('Storage quota exceeded, cleaning old entries');
      await cleanOldEntries();
      // Try again after cleanup
      await chrome.storage.sync.set(obj);
    } else {
      throw error;
    }
  }
}

// Clean old storage entries
async function cleanOldEntries() {
  const data = await chrome.storage.sync.get();
  const keys = Object.keys(data);
  
  // Remove tab locks first (they're temporary anyway)
  const tabLocks = keys.filter(key => key.startsWith('Tab#'));
  if (tabLocks.length > 0) {
    await chrome.storage.sync.remove(tabLocks);
    console.log(`Cleaned ${tabLocks.length} tab locks`);
    return;
  }
  
  // If no tab locks, remove oldest entries (this is basic, could be improved)
  const oldEntries = keys.filter(key => !['options', 'userLanguage'].includes(key)).slice(0, CONSTANTS.STORAGE.CLEANUP_BATCH_SIZE);
  if (oldEntries.length > 0) {
    await chrome.storage.sync.remove(oldEntries);
    console.log(`Cleaned ${oldEntries.length} old entries`);
  }
}

// ===== MODERN CAPABILITY DETECTION SYSTEM =====

// Test tab capabilities dynamically
async function testTabCapabilities(tabId, url) {
  // Quick protocol check for browser-internal pages
  if (url.startsWith('chrome://') || 
      url.startsWith('chrome-extension://') || 
      url.startsWith('edge://') || 
      url.startsWith('moz-extension://') ||
      url.startsWith('about:')) {
    return TabCapability.RESTRICTED;
  }

  // Test capability dynamically - let Chrome's security model decide what's restricted
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Read-only test: just verify we can access the document
        return typeof document.title === 'string' ? 'test_success' : 'no_access';
      }
    });
    
    if (result && result[0] && result[0].result === 'test_success') {
      return TabCapability.FULL_ACCESS;
    } else {
      return TabCapability.RESTRICTED;
    }
  } catch (e) {
    // Any script injection failure = restricted site
    console.debug(`Tab ReTitler: Script injection blocked for ${url}: ${e.message}`);
    return TabCapability.RESTRICTED;
  }
}

// Get cached or test tab capability
async function getTabCapability(tabId, url) {
  // Check cache first
  const cacheKey = `${tabId}_${url}`;
  if (tabCapabilities.has(cacheKey)) {
    const cached = tabCapabilities.get(cacheKey);
    console.debug(`Tab ReTitler: Using cached capability ${cached} for tab ${tabId}`);
    return cached;
  }

  // Test and cache
  console.debug(`Tab ReTitler: Testing capability for tab ${tabId}: ${url}`);
  const capability = await testTabCapabilities(tabId, url);
  tabCapabilities.set(cacheKey, capability);
  
  // Auto-cleanup cache after 5 minutes
  setTimeout(() => {
    tabCapabilities.delete(cacheKey);
  }, 5 * 60 * 1000);
  
  console.debug(`Tab ReTitler: Capability test result for tab ${tabId}: ${capability}`);
  return capability;
}

// Multi-layer title update with fallback
async function updateTabTitleWithFallback(tabId, newTitle, oldTitle, url) {
  const capability = await getTabCapability(tabId, url);
  
  console.debug(`Tab ReTitler: Tab ${tabId} capability: ${capability} for URL: ${url}`);
  
  switch (capability) {
    case TabCapability.FULL_ACCESS:
      console.debug(`Tab ReTitler: Attempting script injection for tab ${tabId}`);
      return await updateViaScriptInjection(tabId, newTitle, oldTitle);
    
    case TabCapability.RESTRICTED:
      console.info(`Tab ReTitler: Restricted site, cannot modify title: ${url}`);
      return false;
    
    case TabCapability.UNKNOWN:
      console.warn(`Tab ReTitler: Unknown tab state ${tabId}, attempting injection anyway`);
      return await updateViaScriptInjection(tabId, newTitle, oldTitle);
    
    default:
      console.warn(`Tab ReTitler: Unexpected capability ${capability} for tab ${tabId}, falling back`);
      return await updateViaScriptInjection(tabId, newTitle, oldTitle);
  }
}

// Script injection method (existing logic)
async function updateViaScriptInjection(tabId, newTitle, oldTitle) {
  try {
    // Mark this as our change to prevent loop
    ourTitleChanges.set(tabId, newTitle);
    
    // 1. Inject the MAIN world hijacker to prevent the SPA from causing flickers
    // This is CSP-safe in MV3.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          if (window.__tabRetitlerHijacked) return;
          window.__tabRetitlerHijacked = true;
          
          const origDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'title') || Object.getOwnPropertyDescriptor(document, 'title');
          if (!origDesc) return;
          
          const origSet = origDesc.set;
          const origGet = origDesc.get;
          window.__tabRetitlerVirtualTitle = origGet ? origGet.call(document) : '';
          
          Object.defineProperty(document, 'title', {
            get() { return window.__tabRetitlerVirtualTitle; },
            set(val) {
              window.__tabRetitlerVirtualTitle = val;
              const lockedTitle = document.documentElement.dataset.tabRetitlerLock;
              if (!lockedTitle && origSet) {
                origSet.call(document, val);
              }
            },
            configurable: true
          });
          
          window.addEventListener('TabRetitlerUnlock', () => {
            delete document.documentElement.dataset.tabRetitlerLock;
            if (origSet && window.__tabRetitlerVirtualTitle) {
              origSet.call(document, window.__tabRetitlerVirtualTitle);
            }
          });
        }
      });
    } catch (hijackErr) {
      console.debug("Tab ReTitler: Failed to inject MAIN world hijacker", hijackErr);
    }

    // 2. Try to use the modern message-based approach which activates the lock in content.js
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        action: 'setTitle',
        title: newTitle
      });
      if (response && response.success) {
        console.debug(`Tab ReTitler: Successfully locked title for tab ${tabId} via content script: "${newTitle}"`);
        // Remove the mark after a short delay
        setTimeout(() => {
          ourTitleChanges.delete(tabId);
        }, CONSTANTS.THROTTLE.TITLE_CHANGE_TIMEOUT);
        return true;
      }
    } catch (msgErr) {
      // Content script might not be injected
      console.debug(`Tab ReTitler: sendMessage failed for tab ${tabId}, falling back to executeScript`);
    }

    // Fallback to direct executeScript if sendMessage failed
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (title) => { 
        document.documentElement.dataset.tabRetitlerLock = title;
        document.title = title; 
        return document.title; // Return the set title for verification
      },
      args: [newTitle]
    });
    
    // Remove the mark after a short delay
    setTimeout(() => {
      ourTitleChanges.delete(tabId);
    }, CONSTANTS.THROTTLE.TITLE_CHANGE_TIMEOUT);
    
    console.debug(`Tab ReTitler: Successfully updated title for tab ${tabId}: "${newTitle}"`);
    return true;
  } catch (e) {
    console.warn(`Tab ReTitler: Script injection failed for tab ${tabId}:`, e.message);
    ourTitleChanges.delete(tabId);
    
    // Re-test capability if injection fails unexpectedly
    const cacheKey = `${tabId}_*`;
    for (const key of tabCapabilities.keys()) {
      if (key.startsWith(`${tabId}_`)) {
        tabCapabilities.delete(key);
      }
    }
    
    return false;
  }
}

// Modern tab update listener with capability detection
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.title && tab.url) {
    // Check if this is our own title change to prevent loops
    if (ourTitleChanges.has(tabId) && ourTitleChanges.get(tabId) === changeInfo.title) {
      return; // Skip our own changes
    }
    
    // Throttle title checking to prevent excessive processing
    const throttleKey = `tab-${tabId}`;
    throttleMessage(throttleKey, () => {
      checkAndUpdateTitle(tabId, tab.url, changeInfo.title);
    });
  }
  
  // Update capability cache when tab status changes
  if (changeInfo.status === 'complete' && tab.url) {
    // Pre-test capabilities for better performance
    const capability = await getTabCapability(tabId, tab.url);
    console.debug(`Tab ReTitler: Tab ${tabId} capability: ${capability}`);
  }
});

// Clean up tab locks and capabilities when tabs are closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Clean up storage
  const tabLockKey = `Tab#${tabId}`;
  const data = await chrome.storage.sync.get(tabLockKey);
  
  if (data[tabLockKey]) {
    await chrome.storage.sync.remove(tabLockKey);
  }
  
  // Clean up all capability cache entries for this tab
  for (const key of tabCapabilities.keys()) {
    if (key.startsWith(`${tabId}_`)) {
      tabCapabilities.delete(key);
    }
  }
  
  console.debug(`Tab ReTitler: Cleaned up resources for closed tab ${tabId}`);
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'setTempTitle') {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (promptMessage) => {
        const newTitle = prompt(promptMessage);
        if (newTitle) document.title = newTitle;
      },
      args: [chrome.i18n.getMessage('promptTempTitle')]
    });
  }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Add error handling wrapper
  const handleMessage = async () => {
    try {
      switch (message.action) {
        case 'setTitle':
          const { tabId, newTitle, oldTitle, type, url, customPattern } = message;
          
          // Validate inputs
          if (!tabId || !newTitle || !oldTitle || !type || !url) {
            throw new Error('Missing required parameters');
          }
          
          const success = await updateTabTitle(tabId, newTitle, oldTitle);
          
          // Check if site is restricted
          const capability = await getTabCapability(tabId, url);
          const isRestricted = capability === TabCapability.RESTRICTED;
          
          if (success && type !== 'onetime') {
            await saveTitle(tabId, url, newTitle, type, customPattern);
          }
          
          sendResponse({ 
            success: success, 
            restricted: isRestricted,
            capability: capability 
          });
          break;
          
        case 'bulkSetTitle':
          const { tabs, title, type: bulkType } = message;
          let successCount = 0;
          let errorCount = 0;
          
          for (const tab of tabs) {
            try {
              const success = await updateTabTitle(tab.id, title, tab.title);
              if (success) {
                successCount++;
                if (bulkType !== 'onetime') {
                  await saveTitle(tab.id, tab.url, title, bulkType);
                }
              } else {
                errorCount++;
              }
            } catch (error) {
              console.error(`Error updating tab ${tab.id}:`, error);
              errorCount++;
            }
          }
          
          sendResponse({ 
            success: true, 
            results: { 
              total: tabs.length, 
              success: successCount, 
              errors: errorCount 
            } 
          });
          break;
          
        case 'checkTitle':
          if (sender.tab) {
            await checkAndUpdateTitle(sender.tab.id, sender.tab.url, message.title);
          }
          sendResponse({ success: true });
          break;
          
        case 'titleChanged':
          if (sender.tab) {
            await checkAndUpdateTitle(sender.tab.id, sender.tab.url, message.title);
          }
          sendResponse({ success: true });
          break;
          
        case 'getMatchedRule':
          if (message.url) {
            const rules = await getRulesFromCache();
            let matchedRule = null;
            
            const sanitizedUrl = sanitizeUrl(message.url);
            if (sanitizedUrl) {
              const tabLockKey = `Tab#${message.tabId}`;
              if (rules[tabLockKey]) {
                matchedRule = rules[tabLockKey];
              } else {
                let matchDomain = null;
                let matchExact = null;
                let bestPrefixPattern = null;
                let bestPrefixLength = -1;
                let keywordPattern = null;
                
                const domainMatch = sanitizedUrl.match(REGEX_DOMAIN);
                if (domainMatch && rules[`*${domainMatch[1]}*`]) {
                  matchDomain = rules[`*${domainMatch[1]}*`];
                }
                
                if (rules[sanitizedUrl]) {
                  matchExact = rules[sanitizedUrl];
                }
                
                for (const pattern in rules) {
                  if (pattern.startsWith('*Tab#') || pattern === 'options' || pattern === 'userLanguage') continue;
                  try {
                    let isMatch = false;
                    
                    if (pattern.startsWith('*') && pattern.endsWith('*') && pattern.includes('|')) {
                      const inner = pattern.slice(1, -1);
                      const keywords = inner.split('|').map(k => k.trim()).filter(k => k);
                      if (keywords.length > 0) {
                        isMatch = keywords.every(k => {
                          const regex = globToRegex(`*${k}*`);
                          return regex.test(sanitizedUrl);
                        });
                      } else {
                        isMatch = false;
                      }
                    } else {
                      const regex = globToRegex(pattern);
                      isMatch = regex.test(sanitizedUrl);
                    }

                    if (isMatch) {
                      if (pattern.endsWith('*') && !pattern.startsWith('*')) {
                        const prefixLen = pattern.length - 1;
                        if (prefixLen > bestPrefixLength) {
                          bestPrefixLength = prefixLen;
                          bestPrefixPattern = pattern;
                        }
                      } else if (pattern.startsWith('*') && pattern.endsWith('*')) {
                        if (!keywordPattern) keywordPattern = pattern;
                      } else if (!keywordPattern) {
                        keywordPattern = pattern;
                      }
                    }
                  } catch (e) {}
                }
                
                if (matchDomain) matchedRule = matchDomain;
                else if (matchExact) matchedRule = matchExact;
                else if (bestPrefixPattern) matchedRule = rules[bestPrefixPattern];
                else if (keywordPattern) matchedRule = rules[keywordPattern];
              }
            }
            sendResponse({ success: true, matchedRule });
          } else {
            sendResponse({ success: false, error: 'No URL provided' });
          }
          break;
          
        case 'changeLanguage':
          const language = await setExtensionLanguage();
          sendResponse({ success: true, language });
          break;
          
        case 'getLanguage':
          chrome.storage.local.get(['currentLanguage', 'translations'], (data) => {
            const language = data.currentLanguage || chrome.i18n.getUILanguage().split('-')[0];
            
            // If we have translations stored, use them
            if (data.translations) {
              translations = data.translations;
            }
            
            sendResponse({ language });
          });
          break;
          
        case 'getTranslatedMessage':
          const translatedMessage = getTranslatedMessage(message.messageName, message.substitutions);
          sendResponse({ message: translatedMessage });
          break;
          
        case 'batchGetTranslatedMessages':
          const results = {};
          for (const key of message.keys) {
            results[key] = getTranslatedMessage(key);
          }
          sendResponse({ messages: results });
          break;
          
        default:
          throw new Error(`Unknown action: ${message.action}`);
      }
    } catch (error) {
      console.error('Error in message handler:', error);
      sendResponse({ success: false, error: error.message });
    }
  };
  
  // Execute the handler
  handleMessage();
  
  // Return true to indicate we'll respond asynchronously
  return true;
});

// Clean up any residual tab locks and initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  await cleanupAndInitialize();
});

// Also initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  // Remove existing menu items first to avoid duplicate ID errors on update
  await chrome.contextMenus.removeAll();
  
  // Create context menu item
  chrome.contextMenus.create({
    id: 'setTempTitle',
    title: chrome.i18n.getMessage('contextMenuSetTitle'),
    contexts: ['page']
  });
  
  await cleanupAndInitialize();
});

// Common initialization function
async function cleanupAndInitialize() {
  const data = await chrome.storage.sync.get();
  
  for (const key in data) {
    if (key.startsWith('Tab#')) {
      await chrome.storage.sync.remove(key);
    }
  }
  
  // Migrate userLanguage to options if it exists
  if (data.userLanguage) {
    const options = data.options || {};
    options.language = data.userLanguage;
    
    // Save updated options and remove userLanguage
    await chrome.storage.sync.set({ options });
    await chrome.storage.sync.remove('userLanguage');
  }
  
  // Initialize language settings
  await setExtensionLanguage();
}

// Validate settings structure
function validateSettingsStructure(settings) {
  try {
    // Check if it's the new format with metadata
    if (settings.metadata && settings.settings) {
      return { valid: true };
    }
    
    // Check if it's the old format (direct settings)
    if (typeof settings === 'object' && settings !== null) {
      return { valid: true };
    }
    
    return { valid: false, error: 'Invalid settings format' };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}