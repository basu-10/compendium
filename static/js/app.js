function highlightEvidence(statementId) {
    document.querySelectorAll('.statement').forEach(function(el) {
        el.classList.remove('active-statement');
    });
    const target = document.querySelector('.statement[data-statement-id="' + statementId + '"]');
    if (target) {
        target.classList.add('active-statement');
    }
}

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
            openModal(title, type, content, filename);
        });
    });
}

function openModal(title, type, content, filename) {
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
    } else {
        body.innerText = content || 'No content available.';
    }
    
    document.getElementById('modal').classList.add('active');
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
}

function toggleFileInput(statementId, type) {
    const fileGroup = document.getElementById('file-group-' + statementId);
    const urlGroup = document.getElementById('url-group-' + statementId);
    if (type === 'link') {
        fileGroup.style.display = 'none';
        urlGroup.style.display = 'block';
    } else {
        fileGroup.style.display = 'block';
        urlGroup.style.display = 'none';
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

window.onclick = function(event) {
    const modal = document.getElementById('modal');
    if (event.target == modal) {
        closeModal();
    }
}
