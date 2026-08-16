// Compendium Capture - Popup Logic

// API base URL. Defaults to the hosted instance; override via the
// "apiBase" key in chrome.storage.local (e.g. for a local dev server).
const DEFAULT_API_BASE = 'https://compendium.pythonanywhere.com';
let API_BASE = DEFAULT_API_BASE;

const domainSelect = document.getElementById('domainSelect');
const folderSelect = document.getElementById('folderSelect');
const topicSelect = document.getElementById('topicSelect');
const statementSelect = document.getElementById('statementSelect');
const titleInput = document.getElementById('titleInput');
const tagsInput = document.getElementById('tagsInput');
const saveBtn = document.getElementById('saveBtn');
const statusDiv = document.getElementById('status');
const loadingOverlay = document.getElementById('loadingOverlay');
const mainContent = document.getElementById('mainContent');
const folderRow = document.getElementById('folderRow');
const authSection = document.getElementById('authSection');
const apiTokenInput = document.getElementById('apiTokenInput');
const saveTokenBtn = document.getElementById('saveTokenBtn');

let treeData = null;
let currentPageData = null;
let apiToken = null;

// Initialize on popup open
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.local.get('apiBase');
  if (stored.apiBase) API_BASE = stored.apiBase;
  await loadToken();
  if (apiToken) {
    authSection.classList.add('hidden');
    await loadTree();
    await loadPendingCapture();
    restoreSelection();
    updateSaveButtonState();
  }
});

// Load saved API token
async function loadToken() {
  const result = await chrome.storage.local.get('apiToken');
  if (result.apiToken) {
    apiToken = result.apiToken;
  } else {
    // Show auth section
    authSection.classList.remove('hidden');
    saveTokenBtn.addEventListener('click', saveToken);
  }
}

async function saveToken() {
  const token = apiTokenInput.value.trim();
  if (!token) {
    showStatus('Please enter an API token', 'error');
    return;
  }
  
  // Test the token by fetching tree
  saveTokenBtn.disabled = true;
  saveTokenBtn.textContent = 'Verifying…';
  
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/tree`);
    if (!response.ok) throw new Error('Invalid token');
    await chrome.storage.local.set({ apiToken: token });
    apiToken = token;
    authSection.classList.add('hidden');
    showStatus('Token saved!', 'success');
    await loadTree();
    await loadPendingCapture();
    restoreSelection();
    updateSaveButtonState();
  } catch (error) {
    showStatus('Invalid token: ' + error.message, 'error');
  } finally {
    saveTokenBtn.disabled = false;
    saveTokenBtn.textContent = 'Save';
  }
}

// Fetch with Authorization header
async function fetchWithAuth(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (apiToken) {
    headers['Authorization'] = `Bearer ${apiToken}`;
  }
  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
}

// Load the domain/folder/topic/statement tree
async function loadTree() {
  showLoading(true);
  try {
    const response = await fetchWithAuth(`${API_BASE}/api/tree`);
    if (!response.ok) throw new Error('Failed to load tree');
    treeData = await response.json();
    populateDomainSelect();
  } catch (error) {
    showStatus('Failed to load destinations: ' + error.message, 'error');
  } finally {
    showLoading(false);
  }
}

// Load pending capture data from background
async function loadPendingCapture() {
  try {
    const result = await chrome.storage.session.get('pendingCapture');
    if (result.pendingCapture) {
      currentPageData = result.pendingCapture;
      titleInput.value = currentPageData.title || '';
      // Clear after reading so it doesn't persist across popup opens
      await chrome.storage.session.remove('pendingCapture');
    } else {
      // Fallback: try to get from current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({ html: document.documentElement.outerHTML, url: window.location.href, title: document.title }),
        });
        if (results[0]?.result) {
          currentPageData = results[0].result;
          titleInput.value = currentPageData.title || '';
        }
      }
    }
  } catch (error) {
    console.error('Failed to load page data:', error);
  }
}

// Populate domain select
function populateDomainSelect() {
  domainSelect.innerHTML = '<option value="">Select a domain…</option>';
  treeData.domains.forEach(domain => {
    const opt = document.createElement('option');
    opt.value = domain.id;
    opt.textContent = domain.name;
    domainSelect.appendChild(opt);
  });
  domainSelect.disabled = false;
}

// Populate folder select for a domain
function populateFolderSelect(domainId) {
  const domain = treeData.domains.find(d => d.id === domainId);
  if (!domain) return;

  folderSelect.innerHTML = '<option value="">Select a folder…</option>';
  let hasFolders = false;

  function addFolders(folders, depth = 0) {
    folders.forEach(folder => {
      const opt = document.createElement('option');
      opt.value = folder.id;
      opt.textContent = '  '.repeat(depth) + folder.name;
      folderSelect.appendChild(opt);
      hasFolders = true;
      if (folder.children?.length) {
        addFolders(folder.children, depth + 1);
      }
    });
  }

  addFolders(domain.folders);

  folderRow.style.display = hasFolders ? 'flex' : 'none';
  folderSelect.disabled = !hasFolders;

  // Also add loose topics to topic select after folder selection
  // (we'll handle this in populateTopicSelect)
}

// Populate topic select for a domain (and optionally folder)
function populateTopicSelect(domainId, folderId = null) {
  const domain = treeData.domains.find(d => d.id === domainId);
  if (!domain) return;

  topicSelect.innerHTML = '<option value="">Select a topic…</option>';

  let topics = [];

  if (folderId) {
    // Find folder in tree and get its topics
    function findFolder(folders) {
      for (const f of folders) {
        if (f.id === folderId) return f;
        if (f.children?.length) {
          const found = findFolder(f.children);
          if (found) return found;
        }
      }
      return null;
    }
    const folder = findFolder(domain.folders);
    if (folder) topics = folder.topics || [];
  } else {
    // Loose topics (no folder)
    topics = domain.loose_topics || [];
  }

  topics.forEach(topic => {
    const opt = document.createElement('option');
    opt.value = topic.id;
    opt.textContent = topic.name;
    topicSelect.appendChild(opt);
  });

  topicSelect.disabled = topics.length === 0;
  populateStatementSelect(null); // Clear statements
}

// Populate statement select for a topic
function populateStatementSelect(topicId) {
  statementSelect.innerHTML = '<option value="">Select a statement…</option>';

  if (!topicId) {
    statementSelect.disabled = true;
    return;
  }

  // Find topic in tree
  let topic = null;
  function findTopic(domains) {
    for (const domain of domains) {
      // Check folders
      function checkFolders(folders) {
        for (const f of folders) {
          const found = f.topics?.find(t => t.id === topicId);
          if (found) return found;
          if (f.children?.length) {
            const nested = checkFolders(f.children);
            if (nested) return nested;
          }
        }
        return null;
      }
      const found = checkFolders(domain.folders);
      if (found) return found;
      // Check loose topics
      const loose = domain.loose_topics?.find(t => t.id === topicId);
      if (loose) return loose;
    }
    return null;
  }
  topic = findTopic(treeData.domains);

  if (topic && topic.statements) {
    topic.statements.forEach(stmt => {
      const opt = document.createElement('option');
      opt.value = stmt.id;
      // Truncate long statements
      const text = stmt.text.length > 80 ? stmt.text.slice(0, 77) + '…' : stmt.text;
      opt.textContent = text;
      statementSelect.appendChild(opt);
    });
  }

  statementSelect.disabled = !topic || !topic.statements?.length;
}

// Event listeners for cascading selects
domainSelect.addEventListener('change', () => {
  const domainId = parseInt(domainSelect.value) || null;
  folderSelect.innerHTML = '<option value="">Select a folder…</option>';
  topicSelect.innerHTML = '<option value="">Select a topic…</option>';
  statementSelect.innerHTML = '<option value="">Select a statement…</option>';
  folderSelect.disabled = true;
  topicSelect.disabled = true;
  statementSelect.disabled = true;
  folderRow.style.display = 'none';

  if (domainId) {
    populateFolderSelect(domainId);
    // Also populate loose topics directly
    const domain = treeData.domains.find(d => d.id === domainId);
    if (domain?.loose_topics?.length) {
      domain.loose_topics.forEach(topic => {
        const opt = document.createElement('option');
        opt.value = topic.id;
        opt.textContent = topic.name + ' (loose)';
        topicSelect.appendChild(opt);
      });
      topicSelect.disabled = false;
    }
  }
  saveSelection();
  updateSaveButtonState();
});

folderSelect.addEventListener('change', () => {
  const domainId = parseInt(domainSelect.value);
  const folderId = parseInt(folderSelect.value) || null;
  topicSelect.innerHTML = '<option value="">Select a topic…</option>';
  statementSelect.innerHTML = '<option value="">Select a statement…</option>';
  statementSelect.disabled = true;

  if (domainId && folderId) {
    populateTopicSelect(domainId, folderId);
  } else if (domainId) {
    // No folder selected - show loose topics
    const domain = treeData.domains.find(d => d.id === domainId);
    if (domain?.loose_topics?.length) {
      domain.loose_topics.forEach(topic => {
        const opt = document.createElement('option');
        opt.value = topic.id;
        opt.textContent = topic.name + ' (loose)';
        topicSelect.appendChild(opt);
      });
      topicSelect.disabled = false;
    }
  }
  saveSelection();
  updateSaveButtonState();
});

topicSelect.addEventListener('change', () => {
  const topicId = parseInt(topicSelect.value) || null;
  populateStatementSelect(topicId);
  saveSelection();
  updateSaveButtonState();
});

statementSelect.addEventListener('change', () => {
  saveSelection();
  updateSaveButtonState();
});

// Save button click
saveBtn.addEventListener('click', async () => {
  const statementId = parseInt(statementSelect.value);
  if (!statementId || !currentPageData) {
    showStatus('Missing required data', 'error');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  showStatus('Saving…', 'loading');

  try {
    const response = await fetchWithAuth(`${API_BASE}/api/capture`, {
      method: 'POST',
      body: JSON.stringify({
        statement_id: statementId,
        title: titleInput.value.trim() || currentPageData.title,
        url: currentPageData.url,
        html: currentPageData.html,
        tags: tagsInput.value.trim(),
      }),
    });

    const result = await response.json();

    if (result.ok) {
      showStatus('Saved successfully! ✓', 'success');
      saveBtn.textContent = 'Saved!';
      // Close popup after short delay
      setTimeout(() => window.close(), 1500);
    } else {
      showStatus('Save failed: ' + (result.error || 'Unknown error'), 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  } catch (error) {
    showStatus('Network error: ' + error.message, 'error');
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
});

// Save/restore selection to chrome.storage.local
function saveSelection() {
  const selection = {
    domainId: domainSelect.value ? parseInt(domainSelect.value) : null,
    folderId: folderSelect.value ? parseInt(folderSelect.value) : null,
    topicId: topicSelect.value ? parseInt(topicSelect.value) : null,
    statementId: statementSelect.value ? parseInt(statementSelect.value) : null,
  };
  chrome.storage.local.set({ captureSelection: selection });
}

function restoreSelection() {
  chrome.storage.local.get('captureSelection', (result) => {
    if (!result.captureSelection || !treeData) return;

    const sel = result.captureSelection;

    if (sel.domainId) {
      domainSelect.value = sel.domainId;
      domainSelect.dispatchEvent(new Event('change'));

      // We need to wait for folder select to populate
      setTimeout(() => {
        if (sel.folderId) {
          folderSelect.value = sel.folderId;
          folderSelect.dispatchEvent(new Event('change'));

          setTimeout(() => {
            if (sel.topicId) {
              topicSelect.value = sel.topicId;
              topicSelect.dispatchEvent(new Event('change'));

              setTimeout(() => {
                if (sel.statementId) {
                  statementSelect.value = sel.statementId;
                  updateSaveButtonState();
                }
              }, 50);
            }
          }, 50);
        } else if (sel.topicId) {
          // Loose topic
          topicSelect.value = sel.topicId;
          topicSelect.dispatchEvent(new Event('change'));

          setTimeout(() => {
            if (sel.statementId) {
              statementSelect.value = sel.statementId;
              updateSaveButtonState();
            }
          }, 50);
        }
      }, 50);
    }
  });
}

function updateSaveButtonState() {
  const hasStatement = statementSelect.value !== '';
  const hasPageData = currentPageData !== null;
  saveBtn.disabled = !(hasStatement && hasPageData);
}

function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + type;
}

function showLoading(show) {
  loadingOverlay.classList.toggle('active', show);
  mainContent.style.opacity = show ? '0.5' : '1';
}