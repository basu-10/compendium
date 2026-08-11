export function initAttachScrape(root, statementId, tabsApi) {
    const scrapeBtn = root.querySelector(`#scrape-btn-${statementId}`);
    const scrapeUrlEl = root.querySelector(`#att-scrape-url-${statementId}`);
    const scrapeStatus = root.querySelector(`#scrape-status-${statementId}`);
    const titleEl = root.querySelector(`#att-title-${statementId}`);
    const hiddenTextarea = root.querySelector(`#att-content-hidden-${statementId}`);

    if (!scrapeBtn) return;

    scrapeBtn.addEventListener('click', async () => {
        const url = scrapeUrlEl?.value?.trim();
        if (!url) {
            if (scrapeStatus) scrapeStatus.textContent = 'Enter a URL first.';
            return;
        }

        scrapeBtn.disabled = true;
        scrapeBtn.textContent = 'Fetching…';
        if (scrapeStatus) scrapeStatus.textContent = '';

        try {
            const response = await fetch('/api/scrape_preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
                throw new Error(data.error || 'Scrape failed');
            }

            if (titleEl && !titleEl.value.trim()) titleEl.value = data.title || '';
            if (hiddenTextarea) hiddenTextarea.value = data.content || '';
            
            tabsApi.selectTab('paste');
            
            if (scrapeStatus) scrapeStatus.textContent = 'Content loaded — review and click Add Asset.';
        } catch (err) {
            if (scrapeStatus) scrapeStatus.textContent = err.message || 'Scrape failed';
        } finally {
            scrapeBtn.disabled = false;
            scrapeBtn.textContent = 'Get Content';
        }
    });
}