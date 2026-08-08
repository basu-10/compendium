// Compendium Capture - Content Script
// Runs on all pages at document_idle to expose page data for capture.

// Expose a global getter for the background script to call via executeScript
window.__COMPENDIUM_CAPTURE__ = {
  getPageData: () => ({
    html: document.documentElement.outerHTML,
    url: window.location.href,
    title: document.title,
  }),
};