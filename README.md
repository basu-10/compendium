# Compendium

**Compendium** is a Flask web application for organizing knowledge into a structured
evidence map. It groups information into three nested levels — **domains → topics →
statements** — where every statement can carry supporting **attachments** (links,
documents, images, videos, text, rich text, and tables). The UI is a clean, single-page
style dashboard with a collapsible sidebar and breadcrumb navigation.

## Features

- **Hierarchical organization**: Domains contain topics, topics contain statements, and
  statements hold attachments — a clean model for claims and their supporting evidence.
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
- **topics** — belong to a domain (`name`, `description`, `created_at`).
- **statements** — belong to a topic (`text`, `created_at`).
- **attachments** — belong to a statement (`title`, `type`, `content`, `filename`); the
  `type` column is constrained to the supported asset types.

Deleting a domain, topic, or statement cascades to its children and removes any
referenced upload files from disk.

## Notes

- There is currently **no authentication layer** — the dashboard identity block is a
  placeholder. Do not expose this app publicly without adding access control.
- Active content (`.html`, `.svg`, etc.) is rejected on upload to prevent stored
  cross-site scripting.
