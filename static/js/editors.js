// --- Rich-text (CKEditor 5) + Spreadsheet (Univer) integration ---
// Loaded after app.js. Exposes hooks used by the evidence card renderer and the
// attachment edit modal. Both editors are rethemed from CSS variables (see
// compendium.css) so they match the active legacy/modern theme.
//
// Design notes:
//  - CKEditor 5 classic build (CDN) is used for rich text. It supports tables
//    natively and has high paste fidelity. Both read-only and editable modes
//    use the same editor instance with `isReadOnly` toggle.
//  - Univer is heavy and its 0.1.x IIFE API is version-sensitive. Every call is
//    wrapped so a missing global or a construction failure degrades gracefully
//    to a read-only HTML table + download link instead of breaking the card.

const COMPENDIUM_EDITORS = (function () {
    let univerInstances = []; // track for teardown on collapse/theme change
    let ckeditorInstances = []; // track for potential cleanup

    function teardownUniver() {
        univerInstances.forEach(function (u) {
            try { if (u && u.dispose) u.dispose(); } catch (e) { /* noop */ }
        });
        univerInstances = [];
    }

    function teardownCkeditors() {
        ckeditorInstances.forEach(function (editor) {
            try { if (editor && editor.destroy) editor.destroy(); } catch (e) { /* noop */ }
        });
        ckeditorInstances = [];
    }

    // Insert an image File/Blob into the editor by uploading it to the server
    // and inserting an <img src="/uploads/..."> reference. This avoids huge
    // Base64 strings in the database and request body.
    async function insertImageFile(editor, file) {
        if (!file) return;

        // Insert a temporary placeholder and KEEP A DIRECT REFERENCE to the
        // element. We must not rely on the selection after the async upload,
        // because the user may have moved the caret in the meantime.
        const placeholderSrc = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        let imageElement = null;
        editor.model.change(function (writer) {
            imageElement = writer.createElement('imageBlock', { src: placeholderSrc });
            editor.model.insertContent(imageElement);
        });

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/upload_richtext_image', {
                method: 'POST',
                body: formData,
                credentials: 'same-origin'
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Upload failed');

            // Replace the placeholder's src with the real server URL on the exact
            // element we inserted.
            editor.model.change(function (writer) {
                if (imageElement) {
                    writer.setAttribute('src', data.url, imageElement);
                }
            });
        } catch (err) {
            console.error('Image upload failed:', err);
            // On failure, remove the placeholder element we inserted.
            editor.model.change(function (writer) {
                if (imageElement) writer.remove(imageElement);
            });
            alert('Failed to upload image: ' + err.message);
        }
    }

    // Read an image from the Async Clipboard API. Some OS/clipboard managers only
    // expose screenshots here (not via the synchronous paste dataTransfer).
    async function readImageFromClipboard() {
        if (!navigator.clipboard || !navigator.clipboard.read) return null;
        const items = await navigator.clipboard.read();
        for (const item of items) {
            const type = (item.types || []).find(function (t) {
                return t.indexOf('image/') === 0;
            });
            if (type) {
                const blob = await item.getType(type);
                if (blob) {
                    // Wrap blob in a File so it has a proper name for the server
                    const ext = type.split('/')[1] || 'png';
                    return new File([blob], `clipboard-image.${ext}`, { type: blob.type });
                }
            }
        }
        return null;
    }

    // Add an "Insert image from device" button above the editor toolbar that
    // opens a file picker and inserts the chosen image as Base64.
    function addImageInsertButton(editor) {
        const editable = editor.ui.getEditableElement();
        if (!editable || !editable.parentElement) return;
        const root = editable.parentElement; // .ck-editor wrapper

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', function () {
            const file = fileInput.files && fileInput.files[0];
            if (file) insertImageFile(editor, file);
            fileInput.value = '';
        });

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ck-image-insert-btn';
        btn.textContent = 'Insert image from device';
        btn.setAttribute('aria-label', 'Insert image from device');
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            fileInput.click();
        });

        const bar = document.createElement('div');
        bar.className = 'ck-image-insert-bar';
        bar.appendChild(btn);
        bar.appendChild(fileInput);

        root.insertBefore(bar, root.firstChild);
    }

    // ---- CKEditor 5 rich text ---------------------------------------------
    async function renderRichText(container, html, readOnly) {
        if (typeof ClassicEditor === 'undefined') {
            // Library failed to load: show the raw text so content is never lost.
            const pre = document.createElement('pre');
            pre.className = 'richtext-body';
            pre.textContent = html || '';
            container.appendChild(pre);
            return;
        }
        const host = document.createElement('div');
        host.className = 'richtext-host' + (readOnly ? ' richtext-reader' : '');
        container.appendChild(host);

        const editor = document.createElement('div');
        host.appendChild(editor);

        const editorConfig = {
            toolbar: readOnly
                ? []
                : {
                    items: [
                        'heading',
                        '|',
                        'bold',
                        'italic',
                        'underline',
                        'strikethrough',
                        'code',
                        'blockquote',
                        '|',
                        'bulletedList',
                        'numberedList',
                        '|',
                        'link',
                        'insertTable',
                        '|',
                        'undo',
                        'redo',
                    ],
                    shouldNotGroupWhenFull: true,
                },
            table: {
                contentToolbar: [
                    'tableColumn',
                    'tableRow',
                    'mergeTableCells',
                    'tableProperties',
                    'tableCellProperties',
                ],
            },
            image: {
                toolbar: [
                    'imageTextAlternative',
                    '|',
                    'imageStyle:inline',
                    'imageStyle:block',
                    'imageStyle:side',
                    '|',
                    'toggleImageCaption',
                ],
            },
            link: {
                addTargetToExternalLinks: true,
                defaultProtocol: 'https',
            },
            readOnly: !!readOnly,
        };

        try {
            const ckeditor = await ClassicEditor.create(editor, editorConfig);
            ckeditor.setData(html || '');
            ckeditorInstances.push(ckeditor);

            if (!readOnly) {
                // Intercept paste at the native level (capture phase) so we can
                // handle images before CKEditor's ClipboardObserver processes them.
                // This prevents "filerepository-no-upload-adapter" errors when
                // pasting screenshots/blob images.
                const editable = ckeditor.ui.getEditableElement();
                if (editable) {
                    editable.addEventListener('paste', (e) => {
                        const dataTransfer = e.clipboardData;
                        if (!dataTransfer || !dataTransfer.items || !dataTransfer.items.length) return;

                        const items = Array.from(dataTransfer.items);
                        const imgItem = items.find(
                            it => it.kind === 'file' && it.type.indexOf('image/') === 0
                        );
                        if (!imgItem) return;

                        const file = imgItem.getAsFile();
                        if (!file) return;

                        e.preventDefault();
                        e.stopPropagation();

                        const reader = new FileReader();
                        reader.onload = function () {
                            const base64 = reader.result;
                            if (!base64) return;
                            ckeditor.model.change(function (writer) {
                                const image = writer.createElement('imageBlock', { src: base64 });
                                ckeditor.model.insertContent(image);
                            });
                        };
                        reader.readAsDataURL(file);
                    }, true); // capture phase - runs before CKEditor's observer
                }

                // Also listen on view.document 'paste' as a fallback for any
                // edge cases the native capture handler might miss.
                ckeditor.editing.view.document.on('paste', (evt, data) => {
                    // If the native handler already processed it, skip
                    if (evt.defaultPrevented) return;

                    const dataTransfer =
                        (data && data.dataTransfer) ||
                        (evt && evt.dataTransfer) ||
                        (evt && evt.domEvent && evt.domEvent.clipboardData) ||
                        null;

                    let imgFile = null;
                    if (dataTransfer && dataTransfer.items && dataTransfer.items.length) {
                        const items = Array.from(dataTransfer.items);
                        const imgItem = items.find(
                            it => it.kind === 'file' && it.type.indexOf('image/') === 0
                        );
                        if (imgItem) imgFile = imgItem.getAsFile();
                    }

                    if (imgFile) {
                        evt.stop();
                        evt.preventDefault();
                        insertImageFile(ckeditor, imgFile);
                        return;
                    }

                    // Fallback: screenshots held by some OS/clipboard managers are
                    // only exposed via the Async Clipboard API, not the synchronous
                    // paste dataTransfer. Only attempt this when the sync clipboard
                    // had no items at all, so we never prompt for permission on
                    // ordinary text/HTML pastes.
                    const syncEmpty =
                        !dataTransfer || !dataTransfer.items || dataTransfer.items.length === 0;
                    if (syncEmpty && navigator.clipboard && navigator.clipboard.read) {
                        readImageFromClipboard()
                            .then(function (blob) {
                                if (blob) insertImageFile(ckeditor, blob);
                            })
                            .catch(function () { /* clipboard unreadable */ });
                    }
                });

                addImageInsertButton(ckeditor);

                return {
                    getData: () => ckeditor.getData(),
                    editor: ckeditor,
                };
            }
            return ckeditor;
        } catch (e) {
            console.error('CKEditor initialization failed:', e);
            // Fallback: render as plain text
            host.innerHTML = '';
            const pre = document.createElement('pre');
            pre.className = 'richtext-body';
            pre.textContent = html || '';
            host.appendChild(pre);
        }
    }

    // ---- Univer spreadsheet -----------------------------------------------
    // Build a minimal Univer Sheets workbook from a 2D array of strings.
    function buildUniver(container, rows, editable) {
        if (typeof window.Univer === 'undefined' || !window.Univer.Core) {
            throw new Error('Univer not available');
        }
        const U = window.Univer;
        const univer = new U.Core.Univer({
            theme: U.Design ? new U.Design.UniverTheme : undefined,
            locale: U.Locales ? U.Locales.enUS : undefined,
        });
        const workbook = univer.createUnit(U.Core.UniverInstanceType.UNIVER_SHEET, {});
        const sheet = workbook.createSheet('Sheet1');
        const startRow = 0, startCol = 0;
        (rows || []).forEach(function (row, r) {
            (row || []).forEach(function (cell, c) {
                try { sheet.getRange(startRow + r, startCol + c).setValue(cell == null ? '' : String(cell)); } catch (e) { /* noop */ }
            });
        });

        const render = new U.RenderEngine.RenderEngine();
        const facade = new U.UI.Facade(univer, render);
        facade.mount(container);
        return { univer: univer, facade: facade, workbook: workbook };
    }

    function rowsToCsv(rows) {
        const esc = function (v) {
            const s = v == null ? '' : String(v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        return (rows || []).map(function (r) { return r.map(esc).join(','); }).join('\n');
    }

    function fallbackTable(container, rows, filename) {
        const wrap = document.createElement('div');
        wrap.className = 'univer-fallback-wrap';
        const table = document.createElement('table');
        if (rows && rows.length) {
            const thead = document.createElement('thead');
            const htr = document.createElement('tr');
            (rows[0] || []).forEach(function () {
                htr.appendChild(document.createElement('th')).textContent = '';
            });
            thead.appendChild(htr);
            table.appendChild(thead);
            const tbody = document.createElement('tbody');
            rows.forEach(function (row, ri) {
                const tr = document.createElement('tr');
                (row || []).forEach(function (cell) {
                    const td = document.createElement('td');
                    td.textContent = cell == null ? '' : String(cell);
                    tr.appendChild(td);
                });
                // First row reads as a header in the fallback for parity.
                if (ri === 0) { tr.classList.add('header-row'); }
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
        }
        wrap.appendChild(table);
        container.appendChild(wrap);
        if (filename) {
            const p = document.createElement('p');
            p.style.marginTop = '0.6rem';
            const a = document.createElement('a');
            a.href = '/uploads/' + encodeURIComponent(filename);
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = 'Download original file';
            a.style.color = 'var(--accent-teal)';
            p.appendChild(a);
            container.appendChild(p);
        }
    }

    // Render a table asset into `container`. `attachmentId` enables editing +
    // save-back when provided; otherwise it is a read-only viewer.
    function renderTable(container, attachmentId, filename) {
        const host = document.createElement('div');
        host.className = 'univer-host';
        container.appendChild(host);

        fetch('/attachment/' + attachmentId + '/table')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.supported && data.rows) {
                    mountUniver(host, data.rows, filename, attachmentId);
                } else {
                    host.className = 'univer-host univer-fallback';
                    host.innerHTML = '';
                    fallbackTable(host, null, data.filename || filename);
                }
            })
            .catch(function () {
                host.className = 'univer-host univer-fallback';
                host.innerHTML = '';
                fallbackTable(host, null, filename);
            });
    }

    function mountUniver(host, rows, filename, attachmentId) {
        try {
            const inst = buildUniver(host, rows, !!attachmentId);
            univerInstances.push(inst.univer);
            if (attachmentId) addSaveBar(host, inst.workbook, attachmentId);
        } catch (e) {
            host.className = 'univer-host univer-fallback';
            host.innerHTML = '';
            fallbackTable(host, rows, filename);
        }
    }

    function addSaveBar(host, workbook, attachmentId) {
        const bar = document.createElement('div');
        bar.className = 'asset-editor-actions';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'btn-primary';
        save.textContent = 'Save changes';
        const status = document.createElement('span');
        status.className = 'asset-editor-status';

        save.addEventListener('click', function () {
            status.className = 'asset-editor-status';
            status.textContent = 'Saving…';
            save.disabled = true;
            let csv = '';
            try {
                const sheet = workbook.getSheet('Sheet1') || workbook.getSheets()[0];
                const range = sheet.getRange(0, 0, sheet.getRowCount(), sheet.getColumnCount());
                const matrix = range.getValues();
                csv = rowsToCsv(matrix);
            } catch (e) {
                status.className = 'asset-editor-status error';
                status.textContent = 'Could not read sheet.';
                save.disabled = false;
                return;
            }
            const form = new FormData();
            form.append('csv', csv);
            fetch('/save_table/' + attachmentId, { method: 'POST', body: form })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    if (j.ok) {
                        status.className = 'asset-editor-status saved';
                        status.textContent = 'Saved.';
                    } else {
                        status.className = 'asset-editor-status error';
                        status.textContent = j.error || 'Save failed.';
                    }
                })
                .catch(function () {
                    status.className = 'asset-editor-status error';
                    status.textContent = 'Save failed.';
                })
                .finally(function () { save.disabled = false; });
        });

        bar.appendChild(save);
        bar.appendChild(status);
        host.insertAdjacentElement('afterend', bar);
    }

    // ---- Image (display only) ---------------------------------------------
    // No library integration yet: render the native <img> inside a themed frame.
    function renderImage(container, src, alt) {
        const frame = document.createElement('div');
        frame.className = 'asset-image-frame';
        const img = document.createElement('img');
        img.className = 'media-preview';
        img.src = src;
        img.alt = alt || '';
        img.loading = 'lazy';
        frame.appendChild(img);
        container.appendChild(frame);
    }

    // ---- Video (Plyr playback) --------------------------------------------
    // Wraps a native <video> in Plyr for consistent, themeable controls. If
    // Plyr is unavailable the plain <video controls> remains fully functional.
    function renderVideo(container, src, title) {
        const wrap = document.createElement('div');
        wrap.className = 'asset-video-frame';
        const video = document.createElement('video');
        video.className = 'media-preview plyr-video';
        video.src = src;
        video.controls = true;
        video.preload = 'metadata';
        video.setAttribute('playsinline', '');
        if (title) video.setAttribute('aria-label', title);
        wrap.appendChild(video);
        container.appendChild(wrap);

        if (typeof Plyr !== 'undefined') {
            try {
                new Plyr(video, {
                    // Accent is driven by the active theme via CSS variables;
                    // see the --plyr-color-main override in compendium.css.
                    ratio: '16:9',
                });
            } catch (e) {
                // Leave the native controls in place on any Plyr failure.
                video.controls = true;
            }
        }
    }

    // Called by app.js when a card collapses or the page unloads, to release
    // Univer canvases and free memory.
    function destroyAll() {
        teardownUniver();
        teardownCkeditors();
    }

    return {
        renderRichText: renderRichText,
        renderTable: renderTable,
        renderImage: renderImage,
        renderVideo: renderVideo,
        destroyAll: destroyAll,
        teardownUniver: teardownUniver,
        teardownCkeditors: teardownCkeditors,
    };
})();

window.COMPENDIUM_EDITORS = COMPENDIUM_EDITORS;