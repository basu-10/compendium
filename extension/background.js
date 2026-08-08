// Compendium Capture - Background Service Worker (MV3)

chrome.action.onClicked.addListener((tab) => {
  // This is called when the user clicks the extension icon
  // The popup opens automatically by default, but we can add
  // additional logic here if needed (e.g., context menu capture)
});

// Optional: Context menu for "Save to Compendium"
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-compendium',
    title: 'Save to Compendium',
    contexts: ['page', 'link', 'image', 'selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-to-compendium') {
    await captureCurrentTab(tab);
  }
});

async function captureCurrentTab(tab) {
  if (!tab.id) return;

  try {
    // Inject content script to get page data
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: getPageData,
    });

    const pageData = results[0]?.result;
    if (!pageData) {
      console.error('Failed to get page data');
      return;
    }

    // Store page data for popup to use
    await chrome.storage.session.set({ pendingCapture: pageData });

    // Note: chrome.action.openPopup() only works from user gesture.
    // The popup will read from storage when opened.
  } catch (error) {
    console.error('Capture failed:', error);
  }
}

function getPageData() {
  return {
    html: document.documentElement.outerHTML,
    url: window.location.href,
    title: document.title,
  };
}

// Expose the capture function to popup if needed
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PAGE_DATA') {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      func: getPageData,
    }).then((results) => {
      sendResponse(results[0]?.result || null);
    });
    return true; // Keep message channel open for async response
  }
});