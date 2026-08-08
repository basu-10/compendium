// --- In-page topic search ---
// Wire the existing (inert) pane-search box to a server-side ?q= reload. A
// debounce avoids a request on every keystroke; Enter submits immediately. The
// active-statement evidence is re-derived server-side, so it survives the reload.
function initPaneSearch() {
    const input = document.getElementById('pane-search-input');
    if (!input) return;
    let timer = null;
    function submit() {
        const value = input.value.trim();
        const params = new URLSearchParams(window.location.search);
        if (value) {
            params.set('q', value);
        } else {
            params.delete('q');
        }
        const qs = params.toString();
        window.location.search = qs ? '?' + qs : '';
    }
    input.addEventListener('input', function() {
        clearTimeout(timer);
        timer = setTimeout(submit, 350);
    });
    input.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            clearTimeout(timer);
            submit();
        }
    });
}

// --- Modal Management ---
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        const focusable = modal.querySelector('input, textarea, select, button');
        if (focusable) focusable.focus();
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        // Edit mode is what reveals an item's delete button, so it must not
        // outlive the editor it was opened for.
        if (typeof clearEditModes === 'function') clearEditModes(null);
    }
}

// Close modal on outside click
document.addEventListener('click', function(event) {
    document.querySelectorAll('.modal-overlay.active').forEach(modal => {
        if (event.target === modal) {
            closeModal(modal.id);
        }
    });
});

// Escape key to close modals
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(modal => {
            closeModal(modal.id);
        });
    }
});

// --- Confirmation Modal ---
function openConfirmModal(modalId, title, message, deleteUrl) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.querySelector('h3').textContent = title;
        modal.querySelector('p').textContent = message;
        modal.querySelector('form').action = deleteUrl;
        openModal(modalId);
    }
}

// --- Hover Actions ---
// Visibility is handled entirely in CSS (:hover + coarse-pointer media query).
// This only handles touch devices revealing actions on tap.
function initHoverActions() {
    document.querySelectorAll('.statement, .topic-header, .evidence-card, .card').forEach(el => {
        const actions = el.querySelector('.hover-actions');
        if (actions) {
            el.addEventListener('touchstart', () => {
                actions.classList.add('touch-visible');
            }, { passive: true });
        }
    });
}

// Server-rendered evidence cards have no inline onclick, so bind them once.
// Cards created later by renderEvidenceCard() bind their own listener.
function initEvidenceCards() {
    document.querySelectorAll('#evidence-content .evidence-card').forEach(function(card) {
        if (card.dataset.bound === '1') return;
        card.dataset.bound = '1';
        bindItemInteractions(card, {
            expand: function() { expandEvidenceCard(card); },
            collapse: function() { collapseEvidenceCard(card); },
            edit: function() { editEvidence(card.dataset.id); },
        });
    });
    initEvidenceOutsideCollapse();
}

// Clicking anywhere outside an expanded card collapses it, replacing the old
// "click inside to collapse" behaviour so expanded text stays selectable.
function initEvidenceOutsideCollapse() {
    document.addEventListener('click', function(event) {
        const expanded = document.querySelector('#evidence-content .evidence-card.expanded');
        if (!expanded) return;
        // Ignore clicks that belong to this card (its buttons/typography) or to
        // a modal (e.g. the confirm-delete dialog) so it can be acted on.
        if (expanded.contains(event.target)) return;
        if (event.target.closest('.modal-overlay')) return;
        collapseEvidenceCard(expanded);
    }, true);
}

// --- Shared single-click / double-click interaction model ---
// Single click expands the item in place; double click opens its editor. A
// click is therefore deferred by DOUBLE_CLICK_DELAY so a second click can
// cancel it -- otherwise every double click would also toggle the expansion.
const DOUBLE_CLICK_DELAY = 250;

function bindItemInteractions(el, handlers) {
    let clickTimer = null;

    el.addEventListener('click', function(event) {
        // Buttons inside the row (edit/delete/attach/collapse) own their own behaviour.
        if (event.target.closest('.hover-actions, a, button')) return;
        // When collapse is delegated to a button + outside-click, a click on an
        // already-expanded card must do nothing (so text stays selectable).
        if (handlers.collapse && el.classList.contains('expanded')) return;
        if (clickTimer !== null) return; // second click; dblclick will fire
        clickTimer = setTimeout(function() {
            clickTimer = null;
            handlers.expand();
        }, DOUBLE_CLICK_DELAY);
    });

    el.addEventListener('dblclick', function(event) {
        if (event.target.closest('.hover-actions, a, button')) return;
        // Cancel the pending single-click expansion so a double click only edits.
        if (clickTimer !== null) {
            clearTimeout(clickTimer);
            clickTimer = null;
        }
        // Double click also selects the text under the cursor; clear it so the
        // row does not stay highlighted behind the modal.
        const selection = window.getSelection();
        if (selection) selection.removeAllRanges();
        handlers.edit();
    });

    // Keyboard parity: Enter expands, and the row is focusable via tabindex.
    el.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            if (event.target !== el) return;
            event.preventDefault();
            handlers.expand();
        }
    });

    // The edit button and double click must run the same code path.
    const editBtn = el.querySelector('.hover-actions .edit-btn');
    if (editBtn) {
        editBtn.addEventListener('click', function(event) {
            event.stopPropagation();
            event.preventDefault();
            handlers.edit();
        });
    }

    // Delete is always available from the toolbar; the confirmation modal is
    // what guards against an accidental click, so no extra gating here.
}

// Edit mode keeps the item visually marked while its modal is open.
function setEditMode(el, on) {
    if (!el) return;
    el.classList.toggle('edit-mode', !!on);
}

// Only one item is ever in edit mode, so clear the rest when a new one opens.
function clearEditModes(except) {
    document.querySelectorAll('.edit-mode').forEach(function(el) {
        if (el !== except) el.classList.remove('edit-mode');
    });
}

// --- Statements: expand in place / edit ---
function initStatements() {
    document.querySelectorAll('#statement-list .statement').forEach(function(row) {
        if (row.dataset.bound === '1') return;
        row.dataset.bound = '1';
        bindItemInteractions(row, {
            expand: function() { toggleStatement(row); },
            edit: function() { editStatement(row); },
        });
    });
    // The "Add Statement" tile flows inline at the end of the list, sized and
    // styled like the add-asset tile in the evidence grid, so the two panes
    // stay visually consistent and the button resizes with the rows.
    buildAddStatementTile();
}

// Trailing placeholder that opens the add-statement modal. Rebuilt client-side
// (rather than server-rendered) so it can be re-appended after the list changes
// and always sits flush with the last statement, like buildAddEvidenceCard.
function buildAddStatementTile() {
    const slot = document.getElementById('add-statement-slot');
    if (!slot) return;
    slot.innerHTML = '';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'add-row';
    btn.id = 'add-statement-row';
    btn.addEventListener('click', function() {
        openModal('add-statement-' + window.location.pathname.split('/').filter(Boolean).pop());
    });

    const plus = document.createElement('span');
    plus.className = 'add-row-plus';
    plus.setAttribute('aria-hidden', 'true');
    plus.textContent = '+';
    btn.appendChild(plus);

    const label = document.createElement('span');
    label.className = 'add-row-label';
    label.textContent = 'Add Statement';
    btn.appendChild(label);

    slot.appendChild(btn);
}

// Statements grow vertically only: the full text is already in the DOM, so
// expanding just lifts the line clamp and shows the evidence for the row.
function toggleStatement(row) {
    const id = row.dataset.statementId;
    const willExpand = !row.classList.contains('expanded');

    // Selecting a statement always drives the right-hand evidence pane, even
    // when collapsing, so the panes cannot fall out of sync.
    showEvidence(id);

    document.querySelectorAll('#statement-list .statement.expanded').forEach(function(other) {
        if (other !== row) other.classList.remove('expanded');
    });
    row.classList.toggle('expanded', willExpand);
    row.setAttribute('aria-expanded', willExpand ? 'true' : 'false');
}

function editStatement(row) {
    clearEditModes(row);
    setEditMode(row, true);
    const modalId = row.dataset.editModal;
    if (modalId) openModal(modalId);
}

// --- Evidence cards: expand in place / edit ---
// Cards expand both ways: they span the full grid width and grow taller, up to
// a capped height after which the body scrolls.
function expandEvidenceCard(card) {
    // Only one card is expanded at a time; collapse any others first.
    document.querySelectorAll('#evidence-content .evidence-card.expanded').forEach(function(other) {
        if (other !== card) collapseEvidenceCard(other);
    });

    card.classList.add('expanded');
    card.setAttribute('aria-expanded', 'true');

    const full = card.querySelector('.evidence-full');
    if (!full) return;
    full.hidden = false;

    // Content is fetched once and cached in the DOM for later re-expansions.
    if (full.dataset.loaded === '1') return;
    full.innerHTML = '';
    full.appendChild(subText('Loading…'));

    fetch('/attachment/' + card.dataset.id)
        .then(function(r) { return r.json(); })
        .then(function(att) {
            full.dataset.loaded = '1';
            renderEvidenceBody(full, att.title, att.type, att.filename,
                               att.content != null ? att.content : (card.dataset.preview || ''));
        })
        .catch(function() {
            renderEvidenceBody(full, card.dataset.title, card.dataset.type,
                               card.dataset.filename, card.dataset.preview || '');
        });
}

function collapseEvidenceCard(card) {
    card.classList.remove('expanded');
    card.setAttribute('aria-expanded', 'false');
    const full = card.querySelector('.evidence-full');
    if (full) full.hidden = true;
    // Release any Univer canvas mounted inside this card to free memory.
    if (window.COMPENDIUM_EDITORS) COMPENDIUM_EDITORS.teardownUniver();
}

function editEvidence(attachmentId) {
    const card = document.querySelector('.evidence-card[data-id="' + attachmentId + '"]');
    clearEditModes(card);
    setEditMode(card, true);
    populateEditForm(attachmentId);
    openModal('edit-attachment-' + attachmentId);
}

// Attach evidence to whichever statement the evidence pane is showing.
function openAttachModal(statementId) {
    if (statementId) openModal('attach-' + statementId);
}

// --- Mobile Accordion ---
function initMobileAccordion() {
    const claimsPane = document.getElementById('claims-pane');
    const evidencePane = document.getElementById('evidence-pane');
    
    function checkMobile() {
        if (window.innerWidth < 768) {
            if (!claimsPane.classList.contains('accordion-pane')) {
                claimsPane.classList.add('accordion-pane');
                evidencePane.classList.add('accordion-pane');
                addAccordionToggles();
            }
        } else {
            claimsPane.classList.remove('accordion-pane', 'collapsed');
            evidencePane.classList.remove('accordion-pane', 'collapsed');
            removeAccordionToggles();
        }
    }
    
    function addAccordionToggles() {
        ['claims-pane', 'evidence-pane'].forEach(paneId => {
            const pane = document.getElementById(paneId);
            const header = pane.querySelector('.pane-header');
            if (header && !header.querySelector('.pane-toggle')) {
                const toggle = document.createElement('button');
                toggle.className = 'pane-toggle';
                toggle.setAttribute('aria-expanded', 'true');
                toggle.onclick = () => {
                    pane.classList.toggle('collapsed');
                    toggle.setAttribute('aria-expanded', !pane.classList.contains('collapsed'));
                };
                header.appendChild(toggle);
            }
        });
    }
    
    function removeAccordionToggles() {
        document.querySelectorAll('.pane-toggle').forEach(btn => btn.remove());
    }
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
}

// --- Attachment form: show file vs content input based on type ---
// Hidden groups are also disabled so the browser omits their values entirely.
// Otherwise a hidden, pre-populated URL field would still be submitted and
// could be stored as the content of a file-backed asset.
function toggleFileInput(statementId, type) {
    const fileGroup = document.getElementById('file-group-' + statementId);
    const urlGroup = document.getElementById('url-group-' + statementId);
    if (!fileGroup || !urlGroup) return;
    // CONTENT_ONLY_TYPES is injected from the server (see topic.html) so this
    // client logic cannot drift from the authoritative Python definition.
    const contentOnly = (window.CONTENT_ONLY_TYPES || ['link', 'text', 'richtext']).indexOf(type) !== -1;
    setGroupActive(urlGroup, contentOnly);
    setGroupActive(fileGroup, !contentOnly);
}

function setGroupActive(group, active) {
    group.style.display = active ? 'block' : 'none';
    group.querySelectorAll('input, textarea, select').forEach(function(field) {
        field.disabled = !active;
    });
}

// --- Evidence rendering ---
// Draws an attachment's full body into `body`. Shared by the in-place card
// expansion for every asset kind.
function renderEvidenceBody(body, title, type, filename, content) {
    body.innerHTML = '';
    const fileUrl = filename ? '/uploads/' + encodeURIComponent(filename) : '';
    const kind = assetKind(type, filename);
    if (kind === 'link') {
        body.appendChild(buildLink(content, content));
    } else if (kind === 'image' && (filename || content)) {
        const src = filename ? fileUrl : '/uploads/' + encodeURIComponent(content);
        if (window.COMPENDIUM_EDITORS) {
            COMPENDIUM_EDITORS.renderImage(body, src, title);
        } else {
            const img = document.createElement('img');
            img.src = src;
            img.className = 'media-preview';
            img.alt = title;
            body.appendChild(img);
        }
    } else if (kind === 'video') {
        if (filename) {
            if (window.COMPENDIUM_EDITORS) {
                COMPENDIUM_EDITORS.renderVideo(body, fileUrl, title);
            } else {
                const video = document.createElement('video');
                video.src = fileUrl;
                video.controls = true;
                video.className = 'media-preview';
                body.appendChild(video);
            }
        } else {
            body.appendChild(buildLink(content, 'Watch Video'));
        }
    } else if (kind === 'table') {
        // Editable/viewer spreadsheet (Univer) with graceful HTML fallback.
        if (window.COMPENDIUM_EDITORS) {
            COMPENDIUM_EDITORS.renderTable(body, card.dataset.id, filename);
        } else {
            body.appendChild(buildLink(fileUrl || content, 'Download Table'));
        }
    } else if (kind === 'richtext') {
        if (window.COMPENDIUM_EDITORS) {
            COMPENDIUM_EDITORS.renderRichText(body, content, true);
        } else {
            const pre = document.createElement('pre');
            pre.className = 'richtext-body';
            pre.textContent = content;
            body.appendChild(pre);
        }
    } else if (filename) {
        body.appendChild(buildLink(fileUrl, 'Download File'));
    } else {
        body.innerText = content || 'No content available.';
    }
}

// Only allow http(s) and single-slash same-origin relative URLs, so a stored
// "javascript:" value can never become a clickable script and a protocol-
// relative "//evil.com" cannot become an off-origin open redirect.
function safeUrl(url) {
    const value = (url || '').trim();
    if (/^https?:\/\//i.test(value)) return value;
    // A single leading slash is same-origin; "//host" or "/\host" is not.
    if (/^\/(?![/\\])/.test(value)) return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '#';
    return value ? 'https://' + value : '#';
}

function buildLink(url, text) {
    const a = document.createElement('a');
    a.href = safeUrl(url);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.color = 'var(--accent-teal)';
    a.textContent = text;
    return a;
}

// --- Asset kind mapping (mirrors asset_kind() in app.py) ---
const TYPE_TO_KIND = {
    link: 'link',
    text: 'richtext',
    richtext: 'richtext',
    image: 'image',
    video: 'video',
    table: 'table',
    document: 'file'
};
const TABLE_EXTENSIONS = ['csv', 'tsv', 'xls', 'xlsx', 'ods'];

// Inline SVG markup for each asset kind. Mirrors the per-kind <svg> files in
// templates/components/icons/ so the JS-rendered cards (statement click, edit
// form) draw the same icon as the server-rendered ones. Keep in sync.
const ASSET_ICONS = {
    link: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    richtext: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 6h16"/><path d="M4 11h12"/><path d="M4 16h16"/><path d="M4 21h8"/></svg>',
    image: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-4.5-4.5L7 20"/></svg>',
    video: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="m22 8-6 4 6 4V8Z"/></svg>',
    table: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 9v12"/><path d="M15 9v12"/></svg>',
    file: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/></svg>'
};

function assetIconSvg(kind) {
    return ASSET_ICONS[kind] || ASSET_ICONS.file;
}

function assetKind(type, filename) {
    let kind = TYPE_TO_KIND[type] || 'file';
    if (kind === 'file' && filename && filename.indexOf('.') !== -1) {
        const ext = filename.split('.').pop().toLowerCase();
        if (TABLE_EXTENSIONS.indexOf(ext) !== -1) return 'table';
    }
    return kind;
}

// Builds one evidence card. Mirrors templates/components/evidence_card.html.
function renderEvidenceCard(att) {
    const kind = att.kind || assetKind(att.type, att.filename);
    const filename = att.filename || '';

    const card = document.createElement('div');
    card.className = 'evidence-card';
    card.dataset.kind = kind;
    card.dataset.id = att.id;
    card.dataset.title = att.title;
    card.dataset.type = att.type;
    card.dataset.filename = filename;
    card.dataset.preview = att.preview != null ? att.preview : '';
    card.dataset.editModal = 'edit-attachment-' + att.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-expanded', 'false');

    // Header: type badge (icon + label) + hover actions
    const header = document.createElement('div');
    header.className = 'evidence-card-header';

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.title = 'Drag to reorder';
    handle.innerHTML = '&#8942;&#8942;';
    header.appendChild(handle);

    const badge = document.createElement('span');
    badge.className = 'evidence-type';

    const icon = document.createElement('span');
    icon.className = 'evidence-type-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = assetIconSvg(kind);

    const label = document.createElement('span');
    label.className = 'evidence-type-label';
    label.textContent = kind;

    badge.appendChild(icon);
    badge.appendChild(label);
    header.appendChild(badge);

    const actions = document.createElement('div');
    actions.className = 'hover-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn edit-btn';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit');
    editBtn.dataset.editModal = 'edit-attachment-' + att.id;
    editBtn.textContent = '\u270E';
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'icon-btn delete-btn';
    deleteBtn.title = 'Delete';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.textContent = '\uD83D\uDDD1';
    deleteBtn.addEventListener('click', function(event) {
        event.stopPropagation();
        openConfirmModal(
            'delete-attachment',
            'Delete Evidence',
            'Are you sure you want to delete this evidence asset?',
            '/delete_attachment/' + att.id
        );
    });
    actions.appendChild(deleteBtn);

    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'icon-btn duplicate-btn';
    dupBtn.title = 'Duplicate';
    dupBtn.setAttribute('aria-label', 'Duplicate');
    dupBtn.textContent = '\u29C9';
    dupBtn.addEventListener('click', function(event) {
        event.stopPropagation();
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/duplicate_attachment/' + att.id;
        document.body.appendChild(form);
        form.submit();
    });
    actions.appendChild(dupBtn);

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'icon-btn collapse-btn';
    collapseBtn.title = 'Restore size';
    collapseBtn.setAttribute('aria-label', 'Restore size');
    collapseBtn.textContent = '\u25B2';
    collapseBtn.addEventListener('click', function(event) {
        event.stopPropagation();
        collapseEvidenceCard(card);
    });
    actions.appendChild(collapseBtn);

    header.appendChild(actions);
    card.appendChild(header);

    const heading = document.createElement('h4');
    heading.textContent = att.title;
    card.appendChild(heading);

    const tags = (att.tags || '').split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    if (tags.length) {
        const tagWrap = document.createElement('div');
        tagWrap.className = 'evidence-tags';
        tags.forEach(function(t) {
            const tag = document.createElement('span');
            tag.className = 'evidence-tag';
            tag.textContent = t;
            tagWrap.appendChild(tag);
        });
        card.appendChild(tagWrap);
    }

    const preview = document.createElement('div');
    preview.className = 'evidence-preview';
    const fileUrl = filename ? '/uploads/' + encodeURIComponent(filename) : '';
    // Text kinds ship only `preview`; file-backed kinds ship `content`.
    const displayContent = (att.content != null) ? att.content : (att.preview || '');

    if (kind === 'image') {
        const img = document.createElement('img');
        img.className = 'evidence-thumb';
        img.src = fileUrl || '/uploads/' + encodeURIComponent(displayContent);
        img.alt = att.title;
        img.loading = 'lazy';
        preview.appendChild(img);
    } else if (kind === 'video' && filename) {
        const video = document.createElement('video');
        video.className = 'evidence-thumb';
        video.preload = 'metadata';
        video.muted = true;
        video.src = fileUrl;
        preview.appendChild(video);
    } else if (kind === 'video') {
        preview.appendChild(placeholder('\u25B6'));
        preview.appendChild(subText(displayContent));
    } else if (kind === 'table') {
        preview.appendChild(placeholder('\u25A4'));
        preview.appendChild(subText(filename || displayContent));
    } else if (kind === 'richtext') {
        // `preview` is computed server-side by preview_text() so the card text
        // matches the Jinja-rendered version exactly.
        preview.appendChild(subText(att.preview !== undefined ? att.preview : displayContent));
    } else if (kind === 'link') {
        const p = subText(displayContent);
        p.classList.add('evidence-link');
        preview.appendChild(p);
    } else {
        preview.appendChild(placeholder('\uD83D\uDCC4'));
        preview.appendChild(subText(filename || displayContent));
    }

    card.appendChild(preview);

    // Filled on first expand; mirrors the server-rendered card.
    const full = document.createElement('div');
    full.className = 'evidence-full';
    full.hidden = true;
    card.appendChild(full);

    // Mirror initHoverActions(): on touch devices, reveal the actions on tap.
    card.addEventListener('touchstart', function() {
        card.querySelector('.hover-actions').classList.add('touch-visible');
    }, { passive: true });

    card.dataset.bound = '1';
    bindItemInteractions(card, {
        expand: function() { expandEvidenceCard(card); },
        collapse: function() { collapseEvidenceCard(card); },
        edit: function() { editEvidence(att.id); },
    });

    return card;
}

function placeholder(glyph) {
    const div = document.createElement('div');
    div.className = 'evidence-placeholder';
    div.setAttribute('aria-hidden', 'true');
    div.textContent = glyph;
    return div;
}

function subText(text) {
    const p = document.createElement('p');
    p.className = 'evidence-sub';
    p.textContent = text;
    return p;
}

// Fill an edit form's title/content from the server on demand, so the initial
// page payload never ships full richtext bodies twice (once in evidence_data,
// once in the textarea).
function populateEditForm(attachmentId) {
    const form = document.getElementById('edit-attachment-form-' + attachmentId);
    if (!form) return;
    fetch('/attachment/' + attachmentId)
        .then(function(r) { return r.json(); })
        .then(function(full) {
            const title = form.querySelector('input[name="title"]');
            const content = form.querySelector('textarea[name="content"], input[name="content"]');
            const tags = form.querySelector('input[name="tags"]');
            if (title && full.title != null) title.value = full.title;
            if (content && full.content != null) content.value = full.content;
            if (tags && full.tags != null) tags.value = full.tags;

            // For rich text, swap the plain textarea for a CKEditor 5 editor and keep
            // the underlying textarea as the field the form submits, syncing on
            // every change and on submit.
            if (full.type === 'richtext' && window.COMPENDIUM_EDITORS && content && content.tagName === 'TEXTAREA') {
                // Guard: only build a CKEditor editor once per form load so
                // re-opening the same modal does not stack duplicate editors.
                if (content.dataset.ckeditorReady === '1') return;
                content.dataset.ckeditorReady = '1';
                const wrapper = document.createElement('div');
                content.parentNode.insertBefore(wrapper, content);
                wrapper.appendChild(content);
                content.style.display = 'none';
                const result = COMPENDIUM_EDITORS.renderRichText(wrapper, full.content || '', false);
                if (result && result.getData) {
                    // CKEditor 5: listen for data changes
                    result.editor.model.document.on('change:data', function () {
                        content.value = result.getData();
                    });
                    form.addEventListener('submit', function () {
                        content.value = result.getData();
                    });
                }
            }
        })
        .catch(function() {});
}

// The statement whose assets the evidence pane is currently showing. Kept in
// sync by showEvidence() so the drop zone always targets the selected row.
let currentStatementId = null;

// --- Statement selection -> evidence panel ---
function showEvidence(statementId) {
    highlightEvidence(statementId);
    currentStatementId = statementId;
    // Reflect the selected statement in the URL so a manual refresh (and the
    // server-driven reloads after asset edits) stay on this row.
    try {
        const params = new URLSearchParams(window.location.search);
        if (statementId) {
            params.set('stmt', String(statementId));
        } else {
            params.delete('stmt');
        }
        const qs = params.toString();
        history.replaceState(null, '', qs ? window.location.pathname + '?' + qs : window.location.pathname);
    } catch (e) {}
    const container = document.getElementById('evidence-content');
    if (!container || typeof evidenceData === 'undefined') return;

    const items = evidenceData[statementId] || evidenceData[String(statementId)] || [];
    container.innerHTML = '';

    items.forEach(function(att) {
        container.appendChild(renderEvidenceCard(att));
    });

    // The "add evidence" tile always trails the cards and targets whichever
    // statement is selected, so it doubles as the empty state for a statement
    // that has no evidence yet.
    container.appendChild(buildAddEvidenceCard(statementId, items.length === 0));

    // Reflect the selected statement in the pane title and keep its assets
    // reorderable after the cards are rebuilt client-side.
    const titleEl = document.getElementById('evidence-pane-title');
    if (titleEl) {
        titleEl.textContent = 'Assets';
    }
    initAssetSortable(statementId);
}

function buildAddEvidenceCard(statementId, isEmpty) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'add-card';
    btn.dataset.statementId = statementId;

    const plus = document.createElement('span');
    plus.className = 'add-card-plus';
    plus.setAttribute('aria-hidden', 'true');
    plus.textContent = '+';
    btn.appendChild(plus);

    const label = document.createElement('span');
    label.className = 'add-card-label';
    label.textContent = isEmpty ? 'Add the first asset' : 'Add asset';
    btn.appendChild(label);

    btn.addEventListener('click', function() {
        openAttachModal(statementId);
    });
    return btn;
}

// --- Existing helpers ---
function highlightEvidence(statementId) {
    document.querySelectorAll('.statement').forEach(function(el) {
        el.classList.remove('active-statement');
    });
    const target = document.querySelector('.statement[data-statement-id="' + statementId + '"]');
    if (target) {
        target.classList.add('active-statement');
    }
}

// --- Asset drag-and-drop ---
// The right-hand evidence pane is a drop target. Dropped files are uploaded to
// the currently selected statement (see currentStatementId) and the pane is
// refreshed once the uploads settle, so the new assets appear inline.
function initAssetDropzone() {
    const zone = document.getElementById('evidence-pane');
    if (!zone) return;

    ['dragenter', 'dragover'].forEach(function(evt) {
        zone.addEventListener(evt, function(event) {
            event.preventDefault();
            event.stopPropagation();
            zone.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach(function(evt) {
        zone.addEventListener(evt, function(event) {
            // A leave fires for every child entered; only clear when the pane
            // itself is left, which is when relatedTarget is outside the zone.
            if (evt === 'dragleave' && zone.contains(event.relatedTarget)) return;
            event.preventDefault();
            event.stopPropagation();
            zone.classList.remove('drag-over');
        });
    });

    zone.addEventListener('drop', function(event) {
        const dt = event.dataTransfer;
        if (!dt || !dt.files || dt.files.length === 0) return;
        if (currentStatementId === null) {
            flashMessage('Select a statement first, then drop files onto its assets.');
            return;
        }
        uploadDroppedFiles(currentStatementId, dt.files);
    });
}

// POSTs each dropped file to /upload_drop/<statement_id> and refreshes the
// evidence pane when all uploads resolve. A dropped file list has no title, so
// the server defaults to the filename; the user can rename via the edit modal.
function uploadDroppedFiles(statementId, fileList) {
    const files = Array.from(fileList);
    const promises = files.map(function(file) {
        const form = new FormData();
        form.append('file', file);
        return fetch('/upload_drop/' + statementId, {
            method: 'POST',
            body: form,
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        }).then(function(r) { return r.json(); })
          .catch(function() { return { results: [{ filename: file.name, error: 'Upload failed' }] }; });
    });

    Promise.all(promises).then(function(responses) {
        let rejected = false;
        responses.forEach(function(r) {
            (r.results || []).forEach(function(item) {
                if (item.error) { rejected = true; return; }
                if (item.attachment && typeof evidenceData !== 'undefined') {
                    const sid = String(item.attachment.statement_id);
                    if (!evidenceData[sid]) evidenceData[sid] = [];
                    evidenceData[sid].push(item.attachment);
                }
            });
        });
        if (rejected) {
            flashMessage('Some files were not added (unsupported type or upload failed).');
        }
        // Re-render the selected statement's pane so the dropped assets appear;
        // evidenceData now holds the fresh rows we just merged in.
        showEvidence(statementId);
    });
}

// Lightweight, self-dismissing status line. Reuses the confirm-modal overlay
// styling space cheaply; a dedicated element is created on demand.
function flashMessage(text) {
    let el = document.getElementById('drop-flash');
    if (!el) {
        el = document.createElement('div');
        el.id = 'drop-flash';
        el.className = 'drop-flash';
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el.__t);
    el.__t = setTimeout(function() { el.classList.remove('show'); }, 3500);
}

// --- Drag-to-reorder (SortableJS) ---
// A single Sortable instance is reused for the statement list; the assets grid
// gets a fresh instance on each selection so its closure always knows the
// currently selected statement.
let statementSortable = null;

function initDragReorder() {
    const list = document.getElementById('statement-list');
    if (!list || typeof Sortable === 'undefined') return;
    statementSortable = new Sortable(list, {
        handle: '.drag-handle',
        draggable: '.statement',
        animation: 150,
        onEnd: function() {
            persistOrder('reorder_statements', {TopicId: undefined}, list, '.statement', 'data-statement-id');
        }
    });
}

function initAssetSortable(statementId) {
    const grid = document.getElementById('evidence-content');
    if (!grid || typeof Sortable === 'undefined') return;
    // Only one statement's assets are visible at a time, so replace any existing
    // instance on the grid element rather than stacking them; otherwise a stale
    // closure would persist an old statement id.
    if (grid.__sortable && grid.__sortable.destroy) grid.__sortable.destroy();
    const inst = new Sortable(grid, {
        handle: '.drag-handle',
        draggable: '.evidence-card',
        animation: 150,
        // The trailing add-card tile is not draggable.
        filter: '.add-card',
        onEnd: function() {
            persistOrder('reorder_attachments', {StatementId: statementId}, grid, '.evidence-card', 'data-id');
        }
    });
    // Track by element for cleanup on the next selection, not by statement id
    // (a statement can be re-selected after others, so a per-id guard would
    // leave a stale instance live on the shared grid).
    grid.__sortable = inst;
}

// Reads the current DOM order and POSTs it, so the server becomes the source of
// truth on next load. Kind-specific params (topic_id / statement_id) are appended
// to the form data so the route can scope the update.
function persistOrder(routeName, extra, container, itemSelector, idAttr) {
    const ids = [...container.querySelectorAll(itemSelector)].map(function(el) {
        return el.getAttribute(idAttr);
    });
    const form = new FormData();
    ids.forEach(function(id) { form.append('order', id); });
    Object.keys(extra).forEach(function(k) { if (extra[k] !== undefined) form.append(k, extra[k]); });

    let target;
    if (routeName === 'reorder_statements') {
        const topicId = window.location.pathname.split('/').filter(Boolean).pop();
        target = '/reorder_statements/' + topicId;
    } else {
        target = '/reorder_attachments/' + (extra.StatementId || '');
    }

    fetch(target, {
        method: 'POST',
        body: form,
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }).catch(function() { /* order is best-effort; next reload re-syncs */ });
}

