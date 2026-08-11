# UI / Flow Rules

This file captures the canonical behaviour for the Compendium topic page,
evidence cards, asset creation, and the attachment edit modal. Treat it as
the source of truth when implementing or reviewing changes in these areas.

---

## 1. Asset Creation Entry Points

Users can add evidence to a statement through three input methods in the
**Attach Asset** modal (`templates/modals/attachment_form.html`):

| Tab | Input | Resulting asset type |
|-----|-------|---------------------|
| Paste Text / URL | Raw text, pasted rich text, or a single URL | `richtext` for text; `link` for bare URLs |
| Upload File | Image, video, spreadsheet, document, or text file | Type inferred from extension (see `create_attachment()` in `app.py`) |
| Scrape URL | Page URL | `richtext` (extracted article body) |

**Rules**
- Text files (`.txt`, `.md`, `.rtf`, `.doc`, `.docx`, `.odt`, `.pdf`) are
  parsed into native `richtext` storage; the original file is discarded.
- Spreadsheets (`.csv`, `.tsv`, `.xls`, `.xlsx`, `.ods`) are converted to
  Univer-compatible CSV when possible; otherwise stored as `table` with a
  download fallback.
- Unknown file extensions fall back to `document` (generic file download).
- Title defaults to the file basename or the first 60 chars of text content.
- One of text/content/URL/file is required; the modal validates this server-side.

---

## 2. Evidence Card Display (Collapsed vs Expanded)

Evidence cards (`templates/components/evidence_card.html`) render a **preview**
in their collapsed state and the **full body** only when expanded.

### Collapsed state
- **Rich text**: show plain-text preview only. Raw HTML tags must never be
  visible to the user. Use `preview_text()` (`app.py`) which strips HTML via
  `BeautifulSoup.get_text()` before truncating.
- **Image / video**: show a thumbnail.
- **Table**: show a placeholder icon + filename.
- **Link**: show the URL as text.
- **File**: show a file icon + filename.

### Expanded state (single click)
- Single click expands the card in place (`grid-column: 1 / -1`).
- The full body is fetched from `/attachment/<id>` and rendered inside
  `.evidence-full`.
- Rich text is rendered through `COMPENDIUM_EDITORS.renderRichText()` which
  sanitizes and displays the cleaned HTML.
- Other types render their native viewers (image, video, Univer spreadsheet, etc.).
- The preview area is hidden while expanded.

### Edit mode (double click)
- Double click opens the **Edit Asset** modal for that attachment.
- Single click on an already-expanded card does nothing (text stays selectable).
- Clicking outside an expanded card collapses it.

---

## 3. Edit Asset Modal

**File:** `templates/modals/edit_attachment.html`

### Normal (non-fullscreen) mode
- Shows: Title, Type, Tags, optional Replace File, and Content/URL fields.
- Bottom actions: **Save Changes** + **Cancel**.
- Top-right: **Close (X)** button.

### Fullscreen mode
- Triggered by the **[ ]** button in the header.
- In fullscreen:
  - **Hide** the top-right Close (X) button.
  - **Hide** the bottom Cancel button.
  - The **[ ]** button becomes a **Save + Exit Fullscreen** action.
  - The form fields (Title, Type, Tags, File) are hidden; only the content
    editor remains visible and fills the viewport.
  - A floating **Save** FAB appears when the form is dirty.
- Exiting fullscreen via the **[ ]** button submits the form (if dirty) and
  removes the `fullscreen` class from the overlay.

### CKEditor re-initialisation
- `populateEditForm()` must tear down any previous CKEditor instance for the
  form before creating a new one, so that re-opening the modal always shows
  the current server content.
- The underlying `<textarea>` is kept as the canonical submission source and
  is synced from the editor on every data change and on form submit.

---

## 4. Card Header Actions

**File:** `templates/components/evidence_card.html`

Each card header contains:
- Drag handle (reorder)
- Type badge (icon + label)
- Hover actions: Edit, Delete, Duplicate, Move
- **Restore size (▲)** button

**Rules**
- The **Restore size** button is only meaningful when the card is expanded.
  - **Hidden** by default.
  - **Visible** when the card has `.expanded` and the header is hovered or
    focused, or when the card is in expanded state.
- It must NOT be visible on collapsed cards, even on header hover.

---

## 5. Tab Switching (Attach Modal)

**File:** `templates/modals/attachment_form.html`

The attach modal uses three tabs: Paste Text / URL, Upload File, Scrape URL.

**Rules**
- Tab buttons have `data-tab` values: `paste`, `upload`, `scrape`.
- Panel IDs follow the pattern `panel-<name>-<statement_id>`.
- Switching tabs removes the `hidden` attribute from the active panel and
  adds it to inactive panels.
- The active tab button gets `aria-selected="true"` and the `.active` class.

---

## 6. Preview Text Sanitisation

**Function:** `preview_text()` in `app.py`

- Input: raw attachment content (may contain HTML from CKEditor).
- Output: plain-text preview, truncated to `PREVIEW_LENGTH`.
- HTML tags must be stripped using `BeautifulSoup(text, 'html.parser').get_text()`.
- This function is the single source of truth for both server-rendered
  (Jinja) and client-rendered (JS) card previews.

---

## 7. Mobile Layout

**File:** `static/css/style.css`

- Breakpoints: `768px` (mobile accordion), `640px` (compact adjustments).
- In fullscreen modals on mobile (`max-width: 768px`):
  - Modal padding reduced to `1rem`.
  - Icon buttons enlarged to `40px` for touch targets.
  - FAB save button accounts for `env(safe-area-inset-bottom)`.

---

## 8. Asset Type Rules (Summary)

| User action | Stored type | Edit support |
|-------------|-------------|--------------|
| Paste text / upload text file | `richtext` | Yes (CKEditor) |
| Scrape URL | `richtext` | Yes (CKEditor) |
| Upload image | `image` | Replace file only |
| Upload video | `video` | Replace file / URL |
| Upload spreadsheet | `table` (if parseable) or `document` | Yes (Univer or download) |
| Upload other file | `document` | Download only (no inline editor) |
| Enter bare URL | `link` | URL only |

For types without an inline editor (`image`, `video`, `document` with unknown
extension), the edit modal shows a **Replace File** field and hides the
content editor. The card action button for such assets should be a download
link rather than an edit button.
