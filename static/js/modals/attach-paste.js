import { getCkeditorForHost } from '../utils/ckeditor.js';

let editors = new WeakMap();

export async function initAttachPaste(root, statementId, onContentChange) {
    const modeToggle = root.querySelector('.paste-mode-toggle');
    const textBtn = root.querySelector('.paste-mode-btn[data-mode="text"]');
    const urlBtn = root.querySelector('.paste-mode-btn[data-mode="url"]');
    const textModeEl = root.querySelector('.paste-text-mode');
    const urlModeEl = root.querySelector('.paste-url-mode');
    const ckHost = root.querySelector('.rich-editor-host');
    const hiddenTextarea = root.querySelector(`#att-content-hidden-${statementId}`);
    const urlInput = root.querySelector(`#att-content-url-${statementId}`);
    const pasteIconBtn = root.querySelector('.paste-icon-btn');
    const pasteDropdownTrigger = root.querySelector('.paste-dropdown-trigger');
    const pasteDropdown = root.querySelector('.paste-dropdown-menu');
    const pastePlainItem = root.querySelector('[data-paste-action="plain"]');
    const formHint = root.querySelector('.paste-form-hint');
    const form = root.querySelector(`#attach-form-${statementId}`);

    function setPasteMode(mode) {
        if (mode === 'text') {
            textBtn?.classList.add('active');
            textBtn?.setAttribute('aria-pressed', 'true');
            urlBtn?.classList.remove('active');
            urlBtn?.setAttribute('aria-pressed', 'false');
            textModeEl?.removeAttribute('hidden');
            urlModeEl?.setAttribute('hidden', '');
            if (formHint) formHint.textContent = 'Rich text note — formatting preserved.';
            if (urlInput) urlInput.value = '';
        } else {
            urlBtn?.classList.add('active');
            urlBtn?.setAttribute('aria-pressed', 'true');
            textBtn?.classList.remove('active');
            textBtn?.setAttribute('aria-pressed', 'false');
            urlModeEl?.removeAttribute('hidden');
            textModeEl?.setAttribute('hidden', '');
            if (formHint) formHint.textContent = 'A bare https:// link makes a link asset.';
            if (hiddenTextarea) hiddenTextarea.value = '';
        }
    }

    textBtn?.addEventListener('click', () => setPasteMode('text'));
    urlBtn?.addEventListener('click', () => setPasteMode('url'));

    pasteIconBtn?.addEventListener('click', () => pasteToField(root, statementId, false));
    
    pasteDropdownTrigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = pasteDropdown?.classList.contains('show');
        pasteDropdown?.classList.toggle('show');
        pasteDropdownTrigger?.setAttribute('aria-expanded', String(!isOpen));
    });

    pastePlainItem?.addEventListener('click', () => {
        pasteToField(root, statementId, true);
        pasteDropdown?.classList.remove('show');
        pasteDropdownTrigger?.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('click', (e) => {
        if (pasteDropdown && !pasteDropdown.contains(e.target) && e.target !== pasteDropdownTrigger) {
            pasteDropdown.classList.remove('show');
            pasteDropdownTrigger?.setAttribute('aria-expanded', 'false');
        }
    });

    if (form) {
        form.addEventListener('submit', () => {
            const activeModeBtn = root.querySelector('.paste-mode-btn.active');
            const mode = activeModeBtn?.dataset.mode || 'text';
            if (mode === 'url') {
                if (hiddenTextarea && urlInput) hiddenTextarea.value = urlInput.value;
            } else if (mode === 'text' && ckHost && window.COMPENDIUM_EDITORS) {
                const editor = getCkeditorForHost(ckHost);
                if (editor && hiddenTextarea) hiddenTextarea.value = editor.getData();
            }
        });
    }

    if (ckHost && !ckHost.dataset.ckeditorReady && window.COMPENDIUM_EDITORS) {
        ckHost.dataset.ckeditorReady = '1';
        try {
            const result = await window.COMPENDIUM_EDITORS.renderRichText(ckHost, '', false);
            if (result?.editor) {
                editors.set(ckHost, result.editor);
                result.editor.model.document.on('change:data', () => {
                    if (hiddenTextarea) hiddenTextarea.value = result.getData();
                    if (typeof onContentChange === 'function') onContentChange();
                });
            }
        } catch (e) {
            console.error('CKEditor init failed:', e);
        }
    }

    return { setPasteMode };
}

async function pasteToField(root, statementId, asPlain) {
    const activeModeBtn = root.querySelector('.paste-mode-btn.active');
    const mode = activeModeBtn?.dataset.mode || 'text';
    const hiddenTextarea = root.querySelector(`#att-content-hidden-${statementId}`);
    const urlInput = root.querySelector(`#att-content-url-${statementId}`);
    const ckHost = root.querySelector('.rich-editor-host');

    if (mode === 'url') {
        if (!urlInput) return;
        try {
            const text = await readClipboardText();
            if (!text) {
                flashMessage('Clipboard is empty or unreadable.');
                return;
            }
            urlInput.value = text;
        } catch (e) {
            flashMessage('Clipboard is empty or unreadable.');
        }
        return;
    }

    if (!ckHost) return;

    let html = null;
    let htmlFailed = false;

    try {
        html = await readClipboardHtml();
    } catch (e) {
        htmlFailed = true;
    }

    if (!html && !htmlFailed) {
        try {
            const text = await readClipboardText();
            if (text) {
                html = text.replace(/&/g, '&')
                           .replace(/</g, '<')
                           .replace(/>/g, '>')
                           .replace(/\n/g, '<br>');
            }
        } catch (e) {
        }
    }

    if (!html) {
        flashMessage('Clipboard is empty or unreadable.');
        return;
    }

    const editor = editors.get(ckHost) || getCkeditorForHost(ckHost);
    if (editor) {
        // Strip Base64 image sources: they would blow up the saved payload
        // (413). Live pasting inside the editor is routed through the upload
        // endpoint instead, but clipboard HTML containing data: images must
        // be dropped here.
        const stripped = html.replace(/<img[^>]*src\s*=\s*["']data:image\/[^"']*["'][^>]*>/gi, '');
        if (stripped !== html) {
            html = stripped;
            flashMessage('Pasted images with embedded data were removed. Paste directly into the editor to upload them.');
        }
        if (asPlain) {
            const plain = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
            editor.setData(plain);
        } else {
            editor.setData(html);
        }
    }
}

async function readClipboardText() {
    if (!navigator.clipboard?.readText) throw new Error('Clipboard API unavailable');
    return navigator.clipboard.readText();
}

async function readClipboardHtml() {
    if (!navigator.clipboard?.read) throw new Error('Clipboard API unavailable');
    const items = await navigator.clipboard.read();
    for (const item of items) {
        if (item.types.includes('text/html')) {
            const blob = await item.getType('text/html');
            return blob.text();
        }
    }
    throw new Error('No HTML in clipboard');
}

function flashMessage(msg) {
    if (window.flashMessage) window.flashMessage(msg);
    else alert(msg);
}