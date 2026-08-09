# Compendium

**Compendium** is a Flask web application for organizing knowledge into a structured
evidence map. It groups information into five nested levels —
**domains → folders → topics → statements → attachments** — where every statement can
carry supporting **attachments** (links, documents, images, videos, text, rich text, and
tables). The UI is a clean, single-page style dashboard with a collapsible sidebar and
breadcrumb navigation.

## Features

- **Hierarchical organization**: Domains contain folders, folders contain topics, topics
  contain statements, and statements hold attachments — a clean model for claims and their
  supporting evidence.
- **Rich attachment types**: `link`, `document`, `image`, `video`, `text`, `richtext`,
  and `table` (CSV/TSV/XLS/XLSX/ODS uploads render inline as tables).
- **File uploads** with a strict per-type extension allowlist (100 MB max) stored under
  `uploads/` and served with `nosniff` + sandboxed CSP headers.
- **Dashboard** with aggregate stats, recent topics, recent evidence, and a per-domain
  breakdown.
- **Landing / about pages** plus an "all domains" directory.
- **SQLite persistence** with auto-migration and seed data on first run.

## Project Structure

```
compendium/
├── app.py                 # Flask app, routes, DB init/migration, upload handling
├── requirements.txt       # Python dependencies (Flask)
├── setup_and_run.sh       # Bootstraps a venv and starts the app
├── data/                  # SQLite database (gitignored)
├── uploads/               # User-uploaded files (gitignored)
├── templates/             # Jinja2 templates (base, landing, domain, topic, ...)
├── static/                # CSS and JavaScript assets
└── venv/                  # Virtual environment (gitignored)
```

## Getting Started

### Prerequisites

- Python 3.8+

### Option 1: Automated setup script

```bash
./setup_and_run.sh
```

This creates a virtual environment, installs dependencies from `requirements.txt`, and
launches the app.

### Option 2: Manual setup

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

## Running

The app starts on **port `10000`** with debug mode enabled:

```
http://localhost:10000
```

On first launch it creates the SQLite database (`data/compendium.db`), runs any required
schema migrations, and seeds three example domains.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `app.secret_key` | `compendium-secret-key-change-in-production` | Flask session key — **change before deploying**. |
| `UPLOAD_FOLDER` | `uploads/` | Where uploaded files are stored. |
| `MAX_CONTENT_LENGTH` | `100 MB` | Maximum upload size. |
| `DB_PATH` | `data/compendium.db` | SQLite database location. |

## Data Model

- **domains** — top-level categories (`name`, `description`).
- **folders** — belong to a domain (`name`, `description`, `parent_id`); form a tree inside
  a domain. A topic may sit directly under a domain or under a folder.
- **topics** — belong to a domain (`name`, `description`, `created_at`); optionally linked
  to a folder via `folder_id`.
- **statements** — belong to a topic (`text`, `created_at`).
- **attachments** — belong to a statement (`title`, `type`, `content`, `filename`); the
  `type` column is constrained to the supported asset types.

Deleting a domain, topic, or statement cascades to its children and removes any
referenced upload files from disk.

## Move semantics

There are **three distinct "Move" operations**. Their targets and scope differ; never
conflate them and never change a move target's level in the hierarchy without updating the
guard logic in `app.py` (see each route) and the matching modal.

| Operation | Button location | Route | Moves a… | To a… | Scope / guard |
| --- | --- | --- | --- | --- | --- |
| Move **Topic** | Topic header (⇄) | `move_topic` | topic | **folder** (or loose in domain) | target folder must be in the same domain |
| Move **Statement** | Statement card (⇄) | `move_statement` | statement | **topic** | target topic must be in the **same domain**; never a folder |
| Move **Asset** | Asset/evidence card (⇄) | `move_attachment` | attachment | **statement** | target statement must be in the **same topic**; never a topic/folder |

Hierarchy reminder: `domains › folders › topics › statements › attachments`. A child can
only be re-parented to a **peer or lower sibling level**, never upward. So:
- A statement is re-parented to another **topic** (peer level), never to a **folder**
  (folders sit above topics).
- An asset is re-parented to another **statement** (peer level) **within the same topic**;
  cross-topic asset moves are intentionally out of scope (use Move Statement instead).

The topic-header Move (to a folder) and the statement-card Move (to a topic) use different
modals and different labels on purpose. Keep the labels unambiguous if either is revisited.

### Move UI surfaces
- `templates/modals/move_topic.html` — folder `<select>`.
- `templates/modals/move_statement.html` — same-domain topic `<select>` (excludes current topic).
- `templates/modals/move_attachment.html` — one shared modal for all asset cards; the asset's
  id and current statement are filled by `openMoveAttachmentModal()` in `static/js/app.js`
  when the card's Move button is clicked. The current statement's `<option>` is disabled to
  prevent a no-op self-move.

## Deployment (PythonAnywhere)

The app is served via WSGI (not the dev server). `app.py` guards its `app.run()`
behind `if __name__ == '__main__'` and runs `init_db()` at import time, so a
fresh clone boots cleanly under a WSGI server.

1. **Push to a Git host** (GitHub/GitLab/Bitbucket):
   ```bash
   git add -A && git commit -m "deploy" && git push origin main
   ```
   `data/`, `uploads/`, `venv/`, and `__pycache__` are gitignored, so only
   source is pushed.

2. **On PythonAnywhere** (Bash console), clone and set up the venv once:
   ```bash
   cd ~
   git clone https://github.com/<you>/compendium.git
   cd compendium
   python3 -m venv venv
   source venv/bin/activate
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

3. **Web tab** — set:
   - Source code / Working directory: `/home/<username>/compendium`
   - WSGI file: paste the contents of `wsgi.py` (replacing `<username>`), or
     point it at `/home/<username>/compendium/wsgi.py`.

4. **Update workflow** (repeat for every change):
   ```bash
   cd ~/compendium
   git pull origin main
   source venv/bin/activate
   pip install -r requirements.txt   # only if requirements.txt changed
   ```
   Then click **Reload `<username>.pythonanywhere.com`** in the Web tab.

### Configuration for production
- Set the `COMPANION_SECRET_KEY` environment variable to a strong random value
  (the app falls back to a dev key otherwise).
- Set `FLASK_DEBUG=0` if you ever run `app.py` directly in production.
- There is **no authentication layer** — do not expose publicly without adding
  access control.

## Notes

- There is currently **no authentication layer** — the dashboard identity block is a
  placeholder. Do not expose this app publicly without adding access control.
- Active content (`.html`, `.svg`, etc.) is rejected on upload to prevent stored
  cross-site scripting.
