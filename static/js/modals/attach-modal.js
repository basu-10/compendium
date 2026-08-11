import { initAttachTabs } from './attach-tabs.js';
import { initAttachPaste } from './attach-paste.js';
import { initAttachScrape } from './attach-scrape.js';

export function initAttachModal(root, statementId) {
    if (!root) return;

    const tabsApi = initAttachTabs(root, statementId);
    
    initAttachPaste(root, statementId, () => {
        const fileEl = root.querySelector(`#att-file-${statementId}`);
        const scrapeUrlEl = root.querySelector(`#att-scrape-url-${statementId}`);
        if (fileEl) fileEl.value = '';
        if (scrapeUrlEl) scrapeUrlEl.value = '';
    });
    
    initAttachScrape(root, statementId, tabsApi);

    const fileEl = root.querySelector(`#att-file-${statementId}`);
    const scrapeUrlEl = root.querySelector(`#att-scrape-url-${statementId}`);
    const hiddenTextarea = root.querySelector(`#att-content-hidden-${statementId}`);
    const urlInput = root.querySelector(`#att-content-url-${statementId}`);

    function clearOthers(except) {
        if (except !== 'content') {
            if (hiddenTextarea) hiddenTextarea.value = '';
            if (urlInput) urlInput.value = '';
        }
        if (except !== 'file' && fileEl) fileEl.value = '';
        if (except !== 'scrape' && scrapeUrlEl) scrapeUrlEl.value = '';
    }

    if (urlInput) {
        urlInput.addEventListener('input', () => {
            if (urlInput.value.trim()) clearOthers('content');
        });
    }

    if (fileEl) {
        fileEl.addEventListener('change', () => {
            if (fileEl.value) clearOthers('file');
        });
    }

    if (scrapeUrlEl) {
        scrapeUrlEl.addEventListener('input', () => {
            if (scrapeUrlEl.value.trim()) clearOthers('scrape');
        });
    }

    tabsApi.selectTab('paste');
}

export function openAttachModal(statementId) {
    if (statementId) {
        const modalId = `attach-${statementId}`;
        if (window.openModal) window.openModal(modalId);
    }
}