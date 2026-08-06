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
        card.addEventListener('click', function() {
            openEvidenceModal({
                id: this.dataset.id,
                title: this.dataset.title,
                type: this.dataset.type,
                filename: this.dataset.filename,
                preview: this.dataset.preview,
            });
        });
        // Wire the edit button (emitted by hover_actions.html) to lazy-load
        // the full content into the edit form on open.
        const editBtn = card.querySelector('.hover-actions button[aria-label="Edit"]');
        if (editBtn && card.dataset.id) {
            editBtn.addEventListener('click', function(event) {
                event.stopPropagation();
                populateEditForm(card.dataset.id);
            });
        }
    });
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

// --- Evidence Modal ---
// Accepts the attachment object so full content can be fetched on demand
// (the initial payload ships only a preview).
function openEvidenceModal(att) {
    const id = att.id;
    const title = att.title;
    const type = att.type;
    const filename = att.filename || '';
    document.getElementById('modal-title').innerText = title;
    const kind = assetKind(type, filename);
    document.getElementById('modal-type').innerText = kind.toUpperCase() + ' Asset';
    const body = document.getElementById('modal-body');
    body.innerHTML = '';
    body.appendChild(subText('Loading…'));
    document.getElementById('evidence-modal').classList.add('active');

    fetch('/attachment/' + id)
        .then(function(r) { return r.json(); })
        .then(function(full) {
            renderEvidenceBody(body, title, type, filename,
                               full.content != null ? full.content : (att.preview || ''));
        })
        .catch(function() {
            renderEvidenceBody(body, title, type, filename, att.preview || '');
        });
}

function renderEvidenceBody(body, title, type, filename, content) {
    body.innerHTML = '';
    const fileUrl = filename ? '/uploads/' + encodeURIComponent(filename) : '';
    const kind = assetKind(type, filename);
    if (kind === 'link') {
        body.appendChild(buildLink(content, content));
    } else if (kind === 'image' && (filename || content)) {
        const img = document.createElement('img');
        img.src = filename ? fileUrl : '/uploads/' + encodeURIComponent(content);
        img.className = 'media-preview';
        img.alt = title;
        body.appendChild(img);
    } else if (kind === 'video') {
        if (filename) {
            const video = document.createElement('video');
            video.src = fileUrl;
            video.controls = true;
            video.className = 'media-preview';
            body.appendChild(video);
        } else {
            body.appendChild(buildLink(content, 'Watch Video'));
        }
    } else if (kind === 'table') {
        body.appendChild(buildLink(fileUrl || content, 'Download Table'));
    } else if (kind === 'richtext') {
        const pre = document.createElement('pre');
        pre.className = 'richtext-body';
        pre.textContent = content;
        body.appendChild(pre);
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

function closeEvidenceModal() {
    document.getElementById('evidence-modal').classList.remove('active');
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

    // Header: type badge + hover actions
    const header = document.createElement('div');
    header.className = 'evidence-card-header';

    const badge = document.createElement('span');
    badge.className = 'evidence-type';
    badge.textContent = kind;
    header.appendChild(badge);

    const actions = document.createElement('div');
    actions.className = 'hover-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit');
    editBtn.textContent = '\u270E';
    editBtn.addEventListener('click', function(event) {
        event.stopPropagation();
        populateEditForm(att.id);
        openModal('edit-attachment-' + att.id);
    });
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

    header.appendChild(actions);
    card.appendChild(header);

    const heading = document.createElement('h4');
    heading.textContent = att.title;
    card.appendChild(heading);

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

    // Mirror initHoverActions(): on touch devices, reveal the actions on tap.
    card.addEventListener('touchstart', function() {
        card.querySelector('.hover-actions').classList.add('touch-visible');
    }, { passive: true });

    card.addEventListener('click', function() {
        openEvidenceModal(att);
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
            if (title && full.title != null) title.value = full.title;
            if (content && full.content != null) content.value = full.content;
        })
        .catch(function() {});
}

// --- Statement click -> evidence panel ---
function showEvidence(statementId) {
    highlightEvidence(statementId);
    const container = document.getElementById('evidence-content');
    if (!container || typeof evidenceData === 'undefined') return;

    const items = evidenceData[statementId] || evidenceData[String(statementId)] || [];
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No evidence attached to the selected statement.</p></div>';
        return;
    }

    items.forEach(function(att) {
        container.appendChild(renderEvidenceCard(att));
    });
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
