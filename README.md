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
compendium/            # git repo (code only) — update with git clone / git pull
├── app.py             # Flask app, routes, DB init/migration, upload handling
├── requirements.txt   # Python dependencies (Flask)
├── setup_and_run.sh   # Bootstraps the external venv and starts the app
├── wsgi.py            # PythonAnywhere WSGI entry point
├── templates/         # Jinja2 templates (base, landing, domain, topic, ...)
└── static/            # CSS and JavaScript assets

compendium-data/       # runtime data, sibling of the repo (NOT in git)
├── compendium.db      # SQLite database
└── uploads/           # user-uploaded files

compendium-venv/       # virtual environment, sibling of the repo (NOT in git)
```

## Getting Started

### Prerequisites

- Python 3.8+

### Option 1: Automated setup script

```bash
./setup_and_run.sh
```

This creates the virtual environment at `../compendium-venv`, the data directory at
`../compendium-data`, installs dependencies from `requirements.txt`, and launches the app.

### Option 2: Manual setup

```bash
python3 -m venv ../compendium-venv
source ../compendium-venv/bin/activate
pip install -r requirements.txt
python app.py
```

## Running

The app starts on **port `10000`** with debug mode enabled:

```
http://localhost:10000
```

Generated data lives outside the repo (at `../compendium-data`): the SQLite database
(`compendium.db`) and the `uploads/` folder. These are created on first launch, and are
**not** affected by `git clone`/`git pull`. On first launch it also runs any required
schema migrations and seeds three example domains.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `app.secret_key` | `compendium-dev-secret-key-change-me` | Flask session key — **change before deploying**. |
| `UPLOAD_FOLDER` | `../compendium-data/uploads` | Where uploaded files are stored (sibling of the repo). |
| `MAX_CONTENT_LENGTH` | `100 MB` | Maximum upload size. |
| `DB_PATH` | `../compendium-data/compendium.db` | SQLite database location (sibling of the repo). |

## Data Model

- **domains** — top-level categories (`name`, `description`). Shared, owner-less. A topic
  is attached to a domain **only while published** (see publish model below).
- **folders** — belong to a domain (`name`, `description`, `parent_id`); form a tree inside
  a domain. A topic may sit directly under a domain or under a folder. `domain_id` is
  **nullable**: a folder carries a domain only while published (`is_public = 1`); a private
  folder has `domain_id = NULL`. Folders are themselves owned (`user_id`); they are not
  publish targets themselves — a domain is.

### Domains are publish targets, not ownership containers (hard rule)

Content (topics, and folders that contain topics) is **owned by a user**. A row carries a
`domain_id` only while it is **published** (`is_public = 1`); when private, `domain_id` is
`NULL`. Therefore `folders.domain_id` and `topics.domain_id` are both nullable, and **no
code path may assume content "already has a domain"** — creation of a folder or loose topic
never requires a domain. Publishing attaches the chosen domain.

A **foldered topic's** visibility is **derived from its parent folder**: the topic's own
`is_public` / `domain_id` are not user-editable. Publishing or unpublishing a folder
**cascades** the same `is_public` / `domain_id` to every descendant folder and topic. A
loose topic (`folder_id IS NULL`) is published/unpublished directly by its owner.

### Publish model

A topic is **private** (`is_public = 0`, `domain_id = NULL`) on creation — it lives only in
the owner's personal space. The owner **publishes** it by attaching a domain: `is_public = 1`
and `domain_id = <chosen domain>`. The same row is then visible to everyone (logged in or
out) and is edited live — there is no copy/clone on publish, and nothing is hidden during
editing. **Unpublishing** sets `is_public = 0` and `domain_id = NULL`, returning the topic to
personal space.

A **folder** is published the same way via Publish folder (owner picks the domain); the
publish **cascades** to every topic and sub-folder inside it, so a public folder makes all of
its contents public into that domain, and unpublishing the folder returns the whole subtree
to personal space. Foldered topics have no independent publish control — their visibility
follows the folder.

Any logged-in, non-owning visitor of a public topic may **Duplicate** it. Duplicate creates a
brand-new private topic owned by the duplicating user (`user_id = duplicator`, `domain_id =
NULL`, `is_public = 0`), carrying forward the source's full `authors` list with the duplicator
appended at the end. The append is de-duplicated: if the last author id already equals the
duplicator, nothing is appended (an owner re-duplicating their own public topic does not
repeat the tail entry). The source row is never modified. Owners see the full edit/delete/
duplicate/move toolbar on their own topics; non-owners see only Duplicate.

### Migration (existing data)

On startup `init_db()` migrates legacy data to the publish model: `topics.domain_id` and
`folders.domain_id` are made nullable; every private row (`is_public = 0`) has its `domain_id`
stripped (moved to personal space), while public rows keep theirs. For every foldered topic,
the parent folder's `is_public`/`domain_id` are copied onto the topic (the folder is the
source of truth for foldered visibility). `authors` is added and backfilled with the topic's
owner id. Idempotent, so re-running is safe.

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
   Only source is pushed; `compendium-data/` and `compendium-venv/` live outside
   the repo and are never committed.

2. **On PythonAnywhere** (Bash console), clone and set up the venv once. Because
   data and venv sit *outside* the repo, you can later re-run `git clone` /
   `git pull` freely without touching them:
   ```bash
   cd ~
   git clone https://github.com/<you>/compendium.git
   cd compendium
   python3 -m venv ../compendium-venv
   source ../compendium-venv/bin/activate
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

  3. **Web tab** — set:
    - Source code / Working directory: `/home/<username>/compendium`
    - WSGI file: paste the contents of `wsgi.py` (it derives your username from
      the file path automatically — no manual edit needed), or point it at
      `/home/<username>/compendium/wsgi.py`.

4. **Update workflow** (repeat for every change):
   ```bash
   cd ~/compendium
   git pull origin main
   source ../compendium-venv/bin/activate
   pip install -r requirements.txt   # only if requirements.txt changed
   ```
   Then click **Reload `<username>.pythonanywhere.com`** in the Web tab.

   Because `compendium-data/` (database + uploads) and `compendium-venv/` are
   siblings of the repo, a fresh `git clone` into `~/compendium` never disturbs
   your data or virtual environment.

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
