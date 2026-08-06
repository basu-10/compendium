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
function initHoverActions() {
    document.querySelectorAll('.statement, .topic-header, .evidence-card, .card').forEach(el => {
        const actions = el.querySelector('.hover-actions');
        if (actions) {
            el.addEventListener('mouseenter', () => {
                actions.style.opacity = '1';
            });
            el.addEventListener('mouseleave', () => {
                actions.style.opacity = '0';
            });
            el.addEventListener('touchstart', () => {
                actions.style.opacity = '1';
            }, { passive: true });
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

// --- Existing toggleFileInput (keep) ---
function toggleFileInput(statementId, type) {
    const fileGroup = document.getElementById('file-group-' + statementId);
    const urlGroup = document.getElementById('url-group-' + statementId);
    if (type === 'link' || type === 'text') {
        fileGroup.style.display = 'none';
        urlGroup.style.display = 'block';
    } else {
        fileGroup.style.display = 'block';
        urlGroup.style.display = 'none';
    }
}

// --- Evidence Modal ---
function openEvidenceModal(title, type, content, filename) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-type').innerText = type.toUpperCase() + ' Asset';
    const body = document.getElementById('modal-body');
    
    if (type === 'link') {
        body.innerHTML = '<a href="' + escapeHtml(content) + '" target="_blank" style="color: var(--accent-teal);">' + escapeHtml(content) + '</a>';
    } else if (type === 'image' && filename) {
        body.innerHTML = '<img src="/uploads/' + escapeHtml(filename) + '" class="media-preview" alt="' + escapeHtml(title) + '">';
    } else if (type === 'document' && filename) {
        body.innerHTML = '<a href="/uploads/' + escapeHtml(filename) + '" target="_blank" style="color: var(--accent-teal);">Download File</a>';
    } else if (type === 'video') {
        body.innerHTML = '<a href="' + escapeHtml(content) + '" target="_blank" style="color: var(--accent-teal);">Watch Video</a>';
    } else if (type === 'text') {
        body.innerHTML = '<pre style="background: var(--bg-color); padding: 1rem; border-radius: 4px; overflow-x: auto; white-space: pre-wrap;">' + escapeHtml(content) + '</pre>';
    } else {
        body.innerText = content || 'No content available.';
    }
    
    document.getElementById('evidence-modal').classList.add('active');
}

function closeEvidenceModal() {
    document.getElementById('evidence-modal').classList.remove('active');
}

// --- Existing showEvidence ---
function showEvidence(statementId) {
    highlightEvidence(statementId);
    const container = document.getElementById('evidence-content');
    if (!container || typeof evidenceData === 'undefined') return;
    
    const items = evidenceData[statementId] || [];
    if (items.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No evidence attached to the selected statement.</p></div>';
        return;
    }
    
    let html = '';
    items.forEach(function(att) {
        let preview = '';
        if (att.type === 'link') {
            preview = escapeHtml(att.content);
        } else if (att.type === 'image') {
            preview = 'Uploaded image';
        } else if (att.type === 'document') {
            preview = 'Uploaded document';
        } else if (att.type === 'video') {
            preview = escapeHtml(att.content);
        } else if (att.type === 'text') {
            const previewText = att.content.length > 100 ? att.content.substring(0, 100) + '...' : att.content;
            preview = escapeHtml(previewText);
        }
        
        html += '<div class="evidence-card" data-title="' + escapeAttr(att.title) + '" data-type="' + escapeAttr(att.type) + '" data-content="' + escapeAttr(att.content) + '" data-filename="' + escapeAttr(att.filename || '') + '">';
        html += '<span class="evidence-type">' + escapeHtml(att.type) + '</span>';
        html += '<h4>' + escapeHtml(att.title) + '</h4>';
        html += '<p>' + escapeHtml(preview) + '</p>';
        html += '</div>';
    });
    container.innerHTML = html;
    
    container.querySelectorAll('.evidence-card').forEach(function(card) {
        card.addEventListener('click', function() {
            const title = this.getAttribute('data-title');
            const type = this.getAttribute('data-type');
            const content = this.getAttribute('data-content');
            const filename = this.getAttribute('data-filename');
            openEvidenceModal(title, type, content, filename);
        });
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    return text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
