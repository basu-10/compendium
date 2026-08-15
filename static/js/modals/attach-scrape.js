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
            // Fetch the page in the browser so we avoid the server-side
            // deployment proxy (pythonanywhere only whitelists a few hosts,
            // returning 403 for everything else). We send the raw HTML to the
            // server, which already skips fetching when `html` is provided.
            let html = '';
            let browserFetchFailed = false;
            try {
                const pageResp = await fetch(url, { redirect: 'follow' });
                if (!pageResp.ok) {
                    throw new Error(`Page returned ${pageResp.status}`);
                }
                html = await pageResp.text();
            } catch (fetchErr) {
                browserFetchFailed = true;
                // CORS or network error - guide user to use the extension
                const msg = `This site blocks cross-origin fetches. To capture it:
1. Click "Open in new tab" below
2. Click the Compendium extension icon in your toolbar
3. Select this statement and click Save`;
                if (scrapeStatus) {
                    scrapeStatus.innerHTML = msg.replace(/\n/g, '<br>') + 
                        '<br><br><button type="button" class="btn btn-primary" id="open-tab-btn">Open in new tab</button>';
                    const openBtn = scrapeStatus.querySelector('#open-tab-btn');
                    if (openBtn) openBtn.addEventListener('click', () => window.open(url, '_blank'));
                }
                return;
            }

            const response = await fetch('/api/scrape_preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, html })
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