# Webpage Capture Extension — Implementation Plan

## Goal
Build a Chrome extension (MV3) that saves any webpage as a **richtext asset** under a chosen **topic → statement** in the local Compendium app. The capture uses **server-side Readability** to extract clean article content, **rehosts images** into the local `uploads/` folder, **sanitizes HTML** for security, and stores it as a `richtext` attachment with a `source_url` for provenance. The richtext editor is migrated from **Quill → CKEditor 5** (CDN, no build step) to natively support tables and preserve fidelity.

---

## Architecture Summary

| Component | Responsibility |
|---|---|
| **Extension (MV3)** | Content script grabs `document.documentElement.outerHTML` + `location.href` + `document.title`; popup provides Domain→Topic→Statement picker + title/tags; POSTs raw HTML to `/api/capture`. |
| **Server: `/api/capture`** | JSON endpoint. Runs `readability-lxml` → `nh3` sanitize → image fetch/rehost/rewrite → compose richtext body (title + source link + excerpt + article) → INSERT as `richtext` with `source_url`. |
| **Server: `/api/tree`** | JSON tree: domains → folders → topics → statements. Feeds the extension's picker. |
| **Editor** | Replace Quill with **CKEditor 5** (CDN build). Update `base.html` + `editors.js` + `app.js` integration. |
| **Schema** | Add `source_url TEXT` column to `attachments` table (reuse existing rebuild pattern). |

---

## Decisions Made

| Decision | Choice | Rationale |
|---|---|---|
| Parsing location | **Server-side** | No build step for extension; `readability-lxml` + `nh3` available in Python. |
| Richtext format | **CKEditor 5 HTML** | Native tables, high paste fidelity, single CDN script (no bundler). |
| Image handling | **Rehost to `uploads/`** | Durable, offline, privacy. Server fetches with size/MIME/timeout limits. |
| Auth | **None (local-only)** | Single-user local; extension runs on same origin. CSRF via Flask session cookie (same-site) + same-origin AJAX. |
| Source URL | **New `source_url` column** | Provenance + future dedupe. Tiny migration, high value. |
| Tables | **Native CKEditor tables** | No down-conversion loss. Quill cannot represent tables. |

---

## Phase 1 — Schema & Server Foundations

### 1.1 Add `source_url` column to `attachments`
- Follow the existing `attachments_new` rebuild pattern at `app.py:337–361`.
- Migration: create `attachments_new` with `source_url TEXT`, copy data, drop old, rename.
- Update `ASSET_TYPES` unchanged (still `richtext`).

### 1.2 Add `nh3` and `readability-lxml` to `requirements.txt`
```
nh3>=0.2
readability-lxml>=0.8
requests>=2.31
```

### 1.3 Create `/api/tree` endpoint
- `GET /api/tree` → JSON:
```json
{
  "domains": [
    { "id": 1, "name": "...", "description": "...",
      "folders": [ { "id": 1, "name": "...", "parent_id": null,
                     "topics": [ { "id": 1, "name": "...", "description": "...",
                                   "statements": [ { "id": 1, "text": "..." } ] } ] } ],
      "loose_topics": [ { "id": 2, "name": "...", ... } ]
    }
  ]
}
```
- Reuse existing `build_folder_tree`, `get_folder_subtree`, and topic/statement queries from `app.py`.

### 1.4 Create `/api/capture` endpoint
- **Route**: `POST /api/capture` (JSON body, returns JSON)
- **Input**:
```json
{
  "statement_id": 123,
  "title": "Optional custom title",
  "url": "https://example.com/article",
  "html": "<html>...raw page HTML...</html>",
  "tags": "tag1, tag2"
}
```
- **Pipeline** (all server-side):
  1. **Readability**: `readability_lxml.Document(html).summary()` → clean article HTML + `title()`.
  2. **Sanitize**: `nh3.clean(article_html, attributes={...}, tags={...})` — allow CKEditor-safe elements only (see §1.5).
  3. **Image harvest & rehost**:
     - Parse sanitized HTML, find all `<img src="...">`.
     - For each: `GET` with 10s timeout, max 20 MB, `Accept: image/*`, validate `Content-Type` starts with `image/`.
     - Save to `UPLOAD_FOLDER` using existing safe naming (`uuid.hex.ext`, extension from MIME or URL).
     - Rewrite `src` → `/uploads/<uuid>.<ext>`.
     - Dedup by SHA256 of bytes (optional but recommended).
  4. **Compose richtext body**:
     - `<p><strong>Source:</strong> <a href="{url}">{title}</a></p>`
     - `<p>{excerpt}</p>` (Readability `excerpt` or first paragraph)
     - `<hr>`
     - Article body (sanitized + image-rewritten HTML)
  5. **Insert**: Reuse `create_attachment` insert logic (line 1043–1047) with `type='richtext'`, `content=composed_html`, `filename=None`, `source_url=url`.
- **Response**: `{ "ok": true, "attachment_id": 456 }` or `{ "ok": false, "error": "..." }`.

### 1.5 nh3 allowlist for CKEditor 5 compatibility
```python
CKEDITOR_TAGS = {
    'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'a', 'img', 'hr', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div',
}
CKEDITOR_ATTRS = {
    '*': ['class', 'style', 'id'],
    'a': ['href', 'target', 'rel'],
    'img': ['src', 'alt', 'width', 'height', 'loading'],
    'th': ['scope', 'colspan', 'rowspan'],
    'td': ['colspan', 'rowspan'],
}
# nh3.clean(html, tags=CKEDITOR_TAGS, attributes=CKEDITOR_ATTRS, ...)
```
- Also strip `style` attributes not in a safe property list (or drop `style` entirely and rely on CKEditor classes).
- Normalize `href`/`src` to `http:`/`https:`/`data:image/` only.

---

## Phase 2 — Editor Migration: Quill → CKEditor 5

### 2.1 Update `templates/base.html`
- Remove Quill CDN lines (18, 21).
- Add CKEditor 5 CDN (classic build, includes table, image, link, basic formatting):
```html
<script src="https://cdn.ckeditor.com/ckeditor5/41.3.1/classic/ckeditor.js"></script>
```
- Add minimal CSS override for theming (reuses existing CSS variables in `style.css`).

### 2.2 Rewrite `static/js/editors.js` — replace `renderRichText`
- New `renderRichText(container, html, readOnly)`:
  - If `readOnly`: `ClassicEditor.create(container, { ... }).then(editor => { editor.setData(html); editor.isReadOnly = true; })`
  - If editable: same but with toolbar, and return `{ getData: () => editor.getData() }` instead of `__getQuillHTML`.
  - Toolbar: heading, bold, italic, underline, strikethrough, code, blockquote, bullet/numbered list, link, insertTable, undo/redo.
  - Table plugin enabled by default in classic build.

### 2.3 Update `static/js/app.js` — `populateEditForm` (line 725–743)
- Replace Quill guard (`dataset.quillReady`) with CKEditor guard (`dataset.ckeditorReady`).
- Call `COMPENDIUM_EDITORS.renderRichText(wrapper, full.content || '', false)`.
- Sync on `change:data` event: `content.value = editor.getData()`.
- On form submit: `content.value = editor.getData()`.

### 2.4 Update `evidence_card.html` read-only rendering (line 62)
- Currently renders preview via `preview_text(att.content)`. Keep as-is (preview is plain text).
- Full-body expand (modal) uses `renderRichText` with `readOnly=true` — will now use CKEditor read-only mode.

### 2.5 CSS adjustments (`static/css/style.css`) — CKEditor 5 theming via CSS variable aliases
- **Strategy**: Override CKEditor's internal CSS variables in your existing theme blocks (`:root`, `.theme-legacy`, `.theme-modern`). No editor re-init needed on theme toggle.
- **Add to `:root` (or each theme block)**:
```css
/* CKEditor 5 variable aliases → map to Compendium palette */
--ck-color-base-foreground: var(--color-text);
--ck-color-base-background: var(--color-bg);
--ck-color-base-border: var(--color-border);
--ck-color-primary: var(--accent-teal);
--ck-color-primary-hover: var(--accent-teal-hover);
--ck-color-primary-active: var(--accent-teal-active);
--ck-color-focus-ring: var(--accent-teal);
--ck-color-toolbar-background: var(--color-panel);
--ck-color-toolbar-border: var(--color-border);
--ck-color-dropdown-panel-background: var(--color-panel);
--ck-color-dropdown-panel-border: var(--color-border);
```
- **Component-specific** (optional but recommended):
```css
--ck-color-heading-text: var(--color-heading);
--ck-color-link-default: var(--accent-teal);
--ck-color-table-border: var(--color-border);
--ck-color-table-selected-background: color-mix(in srgb, var(--accent-teal) 15%, transparent);
```
- **Container sizing**: In `.richtext-host` / `.richtext-reader`:
```css
.ck-editor__editable {
  min-height: 120px;
  max-height: 400px;
  overflow-y: auto;
  font-family: var(--font-mono);  /* or --font-ui */
  font-size: var(--fs-body);
  line-height: var(--lh-body);
}
.richtext-reader .ck-editor__editable {
  max-height: none;  /* full content in read-only expand */
}
```
- This replaces the old `.ql-editor` rules. Remove Quill-specific styles.

---

## Phase 3 — Chrome Extension (MV3)

### 3.1 Manifest (`extension/manifest.json`)
```json
{
  "manifest_version": 3,
  "name": "Compendium Capture",
  "version": "1.0.0",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["http://localhost:10000/*"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html", "default_title": "Save to Compendium" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "web_accessible_resources": [{ "resources": ["icon-*.png"], "matches": ["<all_urls>"] }]
}
```

### 3.2 Content script (`extension/content.js`)
- Expose `window.__COMPENDIUM_CAPTURE__ = { getPageData: () => ({ html: document.documentElement.outerHTML, url: location.href, title: document.title }) }`.
- Background script calls this via `scripting.executeScript`.

### 3.3 Background (`extension/background.js`)
- `chrome.action.onClicked` → open popup (default).
- Optional: context menu "Save to Compendium" → capture current tab.

### 3.4 Popup (`extension/popup.html` + `popup.js`)
- **UI**: 
  - Loading state while fetching `/api/tree`.
  - Nested select: Domain → Folder → Topic → Statement (flattened tree).
  - Title input (prefilled with page title).
  - Tags input (comma-separated).
  - Save button.
- **Logic**:
  - On open: `fetch('/api/tree')` → build nested `<select>`/`<optgroup>`.
  - Cache last selection in `chrome.storage.local`.
  - On Save: call `chrome.scripting.executeScript` to get page data → `POST /api/capture` with `{ statement_id, title, url, html, tags }` → show success/error toast → close popup.

### 3.5 Icons
- Add `icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png` in `extension/`.

---

## Phase 4 — Integration & Polish

### 4.1 CSRF / Session for API endpoints
- Since extension runs on same origin (`localhost:10000`), the Flask session cookie is sent automatically.
- `/api/capture` and `/api/tree` use `@app.route(..., methods=['POST'])` with standard Flask request handling.
- No extra token needed for local-only; if exposed later, add a header token.

### 4.2 Error handling & limits
- `/api/capture`:
  - Timeout on image fetch: 10s per image, max 30s total.
  - Max images per page: 50.
  - Max image size: 20 MB each, 100 MB total (reuse `MAX_CONTENT_LENGTH` logic).
  - Failures: skip failed image, log, continue.
- Extension: retry once on network error; show user-facing error.

### 4.3 Dedup (optional but easy)
- On image fetch: compute SHA256; if file exists in `uploads/` with same hash, reuse it.
- On capture: if `source_url` already exists for this `statement_id`, prompt "Already saved — update?" (future).

### 4.4 Testing checklist
- Capture a page with tables → verify table editable in CKEditor.
- Capture a page with many images → verify all rehosted, offline works.
- Capture a page with scripts/iframes → verify sanitized out.
- Edit saved richtext → verify save persists.
- Extension picker loads full tree, caches selection.
- No build step required — extension loads directly, CKEditor from CDN.

---

## File Touch Map

| File | Change |
|---|---|
| `app.py` | +`source_url` migration, +`/api/tree`, +`/api/capture`, +imports (`nh3`, `readability_lxml`, `hashlib`, `requests`) |
| `requirements.txt` | +`nh3`, `readability-lxml`, `requests` |
| `templates/base.html` | Swap Quill CDN → CKEditor 5 CDN |
| `static/js/editors.js` | Rewrite `renderRichText` for CKEditor |
| `static/js/app.js` | Update `populateEditForm` for CKEditor sync |
| `static/css/style.css` | CKEditor theming overrides (CSS variable aliases) |
| `extension/manifest.json` | New |
| `extension/background.js` | New |
| `extension/content.js` | New |
| `extension/popup.html` | New |
| `extension/popup.js` | New |
| `extension/icon-*.png` | New (4 sizes) |

---

## Out of Scope (Explicit)
- Authentication / multi-user.
- PDF / full-page screenshot capture.
- Background sync / offline queue in extension.
- Server-side page fetch (extension sends HTML to avoid SSRF).
- TipTap / ProseMirror (CKEditor chosen for no-build CDN).
- Image dedup (optional, marked as easy follow-up).

---

## Rollout Order
1. Schema migration + `requirements.txt` (run once).
2. `/api/tree` + `/api/capture` endpoints.
3. CKEditor swap in `base.html` + `editors.js` + `app.js` + CSS.
4. Verify richtext edit/save works end-to-end in browser.
5. Build extension bundle, load unpacked in Chrome.
6. Test capture → edit → save round-trip.

---

## Open Questions (None — All Resolved)
- ✅ Editor: CKEditor 5 (no build, native tables).
- ✅ Images: Rehost to `uploads/`.
- ✅ Auth: None (local-only, same-origin cookie).
- ✅ Parsing: Server-side (readability-lxml + nh3).
- ✅ Source URL: New column.
- ✅ CKEditor theming: CSS variable aliases in existing theme blocks.

---

*Plan ready for implementation.*
