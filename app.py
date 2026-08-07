from flask import Flask, render_template, request, redirect, url_for, flash, send_from_directory
import sqlite3
import os
import uuid
from datetime import datetime

app = Flask(__name__)
app.secret_key = 'compendium-secret-key-change-in-production'
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max upload

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'compendium.db')

# Asset types are grouped into a small set of render "kinds" so that cards only
# ever need to know how to draw: richtext, image, video, table, file, link.
ASSET_TYPES = ('link', 'document', 'image', 'video', 'text', 'richtext', 'table')

TYPE_TO_KIND = {
    'link': 'link',
    'text': 'richtext',
    'richtext': 'richtext',
    'image': 'image',
    'video': 'video',
    'table': 'table',
    'document': 'file',
}

# Extensions that should be treated as a table asset when uploaded as a document.
TABLE_EXTENSIONS = ('csv', 'tsv', 'xls', 'xlsx', 'ods')

# Types that carry their payload in `content` and never have an uploaded file.
CONTENT_ONLY_TYPES = ('link', 'text', 'richtext')

# Per-kind upload allowlists. Anything not listed here is rejected outright so
# that active content (.html, .svg, .xhtml, ...) can never be stored and then
# served same-origin from /uploads/.
ALLOWED_EXTENSIONS = {
    'image': ('png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'),
    'video': ('mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v'),
    'table': TABLE_EXTENSIONS,
    'document': (
        'pdf', 'txt', 'md', 'rtf', 'doc', 'docx', 'odt',
        'ppt', 'pptx', 'odp', 'zip', 'json', 'xml',
    ) + TABLE_EXTENSIONS,
}


def _upload_extension(att_type, original_name):
    """Validate an upload's extension for the given type.

    Returns the lowercased extension, or None if it is not allowed.
    """
    if '.' not in original_name:
        return None
    ext = original_name.rsplit('.', 1)[1].lower()
    return ext if ext in ALLOWED_EXTENSIONS.get(att_type, ()) else None


def asset_kind(att_type, filename=None):
    """Map a stored attachment type (plus filename hint) to a render kind."""
    kind = TYPE_TO_KIND.get(att_type, 'file')
    if kind == 'file' and filename and '.' in filename:
        ext = filename.rsplit('.', 1)[1].lower()
        if ext in TABLE_EXTENSIONS:
            return 'table'
    return kind


# Order the kind icons are displayed in on a statement's evidence summary, so
# the badge strip looks the same for every statement regardless of the order
# the attachments happen to have been added in.
KIND_DISPLAY_ORDER = ('link', 'richtext', 'image', 'video', 'table', 'file')


def evidence_summary(attachments):
    """Condense a statement's attachments into a total plus a per-kind tally.

    The left-hand statement list only shows how much evidence is attached and
    which kinds it is, not the evidence itself -- the cards in the right-hand
    pane do that. Returns e.g.
    {'total': 3, 'kinds': [('link', 2), ('image', 1)]}.
    """
    counts = {}
    for att in attachments or ():
        kind = asset_kind(att['type'], att['filename'])
        counts[kind] = counts.get(kind, 0) + 1
    return {
        'total': sum(counts.values()),
        'kinds': [(k, counts[k]) for k in KIND_DISPLAY_ORDER if k in counts],
    }


PREVIEW_LENGTH = 140


def preview_text(text, limit=PREVIEW_LENGTH):
    """Single source of truth for card preview truncation.

    Both the Jinja card and the JS card read the result of this, so a card
    never changes its text when it is re-rendered client-side.
    """
    value = (text or '').strip()
    if len(value) <= limit:
        return value
    return value[:limit].rstrip() + '...'


# Placeholder identity used by the sidebar and the dashboard profile header
# until a real auth layer exists. Defined once so the two render sites cannot
# drift apart -- they appear on screen together on /dashboard.
PLACEHOLDER_USER = {
    'name': 'Alex Rivera',
    'initials': 'AR',
    'role': 'Researcher',
    'email': 'alex@example.com',
}


@app.context_processor
def inject_globals():
    """Values every template can rely on (e.g. the footer copyright year)."""
    return {
        'current_year': datetime.now().year,
        'current_user': PLACEHOLDER_USER,
    }


def get_global_stats(conn):
    """Corpus-wide totals shared by the landing page and the dashboard.

    Both surfaces present these as the same "how big is this corpus" figure,
    so they must be computed in one place: if the definition ever gains a
    filter, the two pages would otherwise silently disagree.
    """
    return conn.execute('''
        SELECT
            (SELECT COUNT(*) FROM domains) AS domain_count,
            (SELECT COUNT(*) FROM topics) AS topic_count,
            (SELECT COUNT(*) FROM statements) AS statement_count,
            (SELECT COUNT(*) FROM attachments) AS attachment_count
    ''').fetchone()


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn

def _ensure_column(conn, cursor, table, column, definition):
    """Add `column` to `table` only if SQLite doesn't already have it.

    SQLite's ALTER TABLE ADD COLUMN is a no-op-prone operation: it cannot be
    guarded with IF NOT EXISTS, so we inspect the schema and skip when present.
    """
    cursor.execute("PRAGMA table_info(%s)" % table)
    if any(row['name'] == column for row in cursor.fetchall()):
        return
    cursor.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, column, definition))


def _backfill_positions(conn, cursor, table, parent_column):
    """Assign sequential positions to rows that still have the default 0.

    Newly added `position` columns default every existing row to 0, which would
    leave ties. Only rows that are still 0 are renumbered by primary-key order
    inside each parent group, so we never disturb an order the user set.
    """
    cursor.execute(
        "SELECT %s, GROUP_CONCAT(id) FROM %s WHERE position = 0 GROUP BY %s"
        % (parent_column, table, parent_column)
    )
    for parent_value, id_csv in cursor.fetchall():
        ids = [i for i in id_csv.split(',') if i]
        cursor.executemany(
            "UPDATE %s SET position = ? WHERE id = ?" % table,
            [(idx, rid) for idx, rid in enumerate(ids)],
        )


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.executescript('''
        CREATE TABLE IF NOT EXISTS domains (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT
        );
        
        CREATE TABLE IF NOT EXISTS topics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            domain_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (domain_id) REFERENCES domains (id)
        );
        
        CREATE TABLE IF NOT EXISTS statements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (topic_id) REFERENCES topics (id) ON DELETE CASCADE
        );
        
        CREATE TABLE IF NOT EXISTS attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            statement_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('link', 'document', 'image', 'video', 'text', 'richtext', 'table')),
            content TEXT NOT NULL,
            filename TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (statement_id) REFERENCES statements (id) ON DELETE CASCADE
        );
    ''')
    
    cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='attachments'")
    existing = cursor.fetchone()
    if existing and 'richtext' not in existing[0]:
        _migrate_attachments_table(conn, cursor)

    # `position` drives manual ordering of statements within a topic and of
    # assets within a statement. Both are added lazily so existing databases get
    # a sensible default (0) and are renumbered by creation order on first use.
    _ensure_column(conn, cursor, 'statements', 'position', 'INTEGER DEFAULT 0')
    _ensure_column(conn, cursor, 'attachments', 'position', 'INTEGER DEFAULT 0')
    _backfill_positions(conn, cursor, 'statements', 'topic_id')
    _backfill_positions(conn, cursor, 'attachments', 'statement_id')
    
    _migrate_domains(conn, cursor)

    cursor.execute('SELECT COUNT(*) FROM domains')
    if cursor.fetchone()[0] == 0:
        cursor.executemany('INSERT INTO domains (name, description) VALUES (?, ?)', [
            ('Computer Science', 'Architecture, backend dev, AI implementations, and databases.'),
            ('Markets & Economics', 'Macro analysis, company 10-K reports, and asset classes.'),
            ('Literature, Media', 'Classic texts, parallel readings, literary criticism, and media.'),
            ('Society, Culture', 'Sociopolitical deep dives, culture, and social structures.'),
            ('Life Sciences', 'Physics, chemistry, biology, and the natural sciences.'),
            ('Math/Statistics/Logic', 'Mathematics, statistics, and formal logic.'),
            ('History', 'Historical eras, events, and their interpretation.')
        ])

    # Index foreign-key child columns so cascade deletes and the per-delete
    # filename lookups are index seeks, not full table scans.
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_attachments_statement_id ON attachments (statement_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_statements_topic_id ON statements (topic_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_topics_domain_id ON topics (domain_id)')
    # Backs the dashboard's "most recent" lists, which order by creation time
    # and take only the newest handful of rows.
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_attachments_created_at ON attachments (created_at DESC)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_topics_created_at ON topics (created_at DESC)')

    conn.commit()
    conn.close()


def _migrate_attachments_table(conn, cursor):
    """Rebuild `attachments` to widen its `type` CHECK constraint.

    Follows SQLite's documented table-rebuild procedure. Foreign keys are
    disabled for the duration (they cannot be toggled inside a transaction),
    the swap runs inside one explicit transaction so a crash between the DROP
    and the RENAME can never leave the database without an `attachments`
    table, and any scratch table left by a previously failed run is dropped
    first so the migration is safely re-runnable. Rows that cannot satisfy the
    foreign key are quarantined in `attachments_orphaned` rather than deleted.
    """
    # PRAGMA foreign_keys is a silent no-op inside a transaction, so finish any
    # implicit one first, then take manual control of transaction boundaries.
    conn.commit()
    prior_isolation = conn.isolation_level
    conn.isolation_level = None
    cursor.execute('PRAGMA foreign_keys = OFF')
    try:
        cursor.execute('BEGIN IMMEDIATE')
        try:
            # Left over from an earlier attempt that failed partway through.
            cursor.execute('DROP TABLE IF EXISTS attachments_new')
            # Rows orphaned while FK enforcement was inert cannot be carried
            # over, but they are user data: copy them into a quarantine table
            # rather than destroying them, and record how many were moved.
            cursor.execute('''CREATE TABLE IF NOT EXISTS attachments_orphaned AS
                SELECT * FROM attachments WHERE 0''')
            cursor.execute('''INSERT INTO attachments_orphaned
                SELECT * FROM attachments
                WHERE statement_id NOT IN (SELECT id FROM statements)''')
            quarantined = cursor.rowcount
            cursor.execute('DELETE FROM attachments WHERE statement_id NOT IN (SELECT id FROM statements)')
            if quarantined:
                app.logger.warning(
                    'attachments migration: moved %d orphaned row(s) into attachments_orphaned',
                    quarantined,
                )
            cursor.execute('''CREATE TABLE attachments_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                statement_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('link', 'document', 'image', 'video', 'text', 'richtext', 'table')),
                content TEXT NOT NULL,
                filename TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (statement_id) REFERENCES statements (id) ON DELETE CASCADE
            )''')
            cursor.execute('INSERT INTO attachments_new SELECT id, statement_id, title, type, content, filename, created_at FROM attachments')
            cursor.execute('DROP TABLE attachments')
            cursor.execute('ALTER TABLE attachments_new RENAME TO attachments')
            # Scoped to the rebuilt table so unrelated pre-existing violations
            # elsewhere in the schema cannot abort startup.
            violations = cursor.execute("PRAGMA foreign_key_check('attachments')").fetchall()
            if violations:
                raise sqlite3.IntegrityError(f'foreign key violations after migration: {violations}')
            cursor.execute('COMMIT')
        except Exception:
            cursor.execute('ROLLBACK')
            raise
    finally:
        cursor.execute('PRAGMA foreign_keys = ON')
        conn.isolation_level = prior_isolation


def _migrate_domains(conn, cursor):
    """Split the legacy 'Literature & Society' domain and add new domains.

    Run on every startup so existing databases converge to the current domain
    set without re-seeding. Idempotent: each change is guarded so repeat runs
    are safe, and it is a no-op when the schema already matches.
    """
    # Split 'Literature & Society' into 'Literature' and 'Society'. The legacy
    # domain's existing topics stay attached to 'Literature'; 'Society' starts
    # empty so the split is reversible and never destroys user data.
    cursor.execute("SELECT id FROM domains WHERE name = 'Literature & Society'")
    legacy = cursor.fetchone()
    if legacy:
        legacy_id = legacy[0]
        cursor.execute(
            "INSERT OR IGNORE INTO domains (name, description) VALUES (?, ?)",
            ('Literature', 'Classic texts, parallel readings, and literary criticism.'),
        )
        cursor.execute(
            "INSERT OR IGNORE INTO domains (name, description) VALUES (?, ?)",
            ('Society', 'Sociopolitical deep dives, culture, and social structures.'),
        )
        cursor.execute("SELECT id FROM domains WHERE name = 'Literature'")
        literature_id = cursor.fetchone()[0]
        cursor.execute(
            "UPDATE topics SET domain_id = ? WHERE domain_id = ?",
            (literature_id, legacy_id),
        )
        cursor.execute("DELETE FROM domains WHERE id = ?", (legacy_id,))

    # Rename domains introduced in an earlier seed so existing databases match
    # the current naming. If the target name already exists we merge the source
    # domain's topics into it before dropping the source, so no data is lost.
    for old_name, new_name in [
        ('Literature', 'Literature, Media'),
        ('Society', 'Society, Culture'),
    ]:
        cursor.execute("SELECT id FROM domains WHERE name = ?", (old_name,))
        source = cursor.fetchone()
        if not source:
            continue
        source_id = source[0]
        cursor.execute("SELECT id FROM domains WHERE name = ?", (new_name,))
        target = cursor.fetchone()
        if target:
            target_id = target[0]
            cursor.execute(
                "UPDATE topics SET domain_id = ? WHERE domain_id = ?",
                (target_id, source_id),
            )
            cursor.execute("DELETE FROM domains WHERE id = ?", (source_id,))
        else:
            cursor.execute(
                "UPDATE domains SET name = ? WHERE id = ?",
                (new_name, source_id),
            )

    # Add the domains introduced after the original seed.
    for name, description in [
        ('Life Sciences', 'Physics, chemistry, biology, and the natural sciences.'),
        ('Math/Statistics/Logic', 'Mathematics, statistics, and formal logic.'),
        ('History', 'Historical eras, events, and their interpretation.'),
    ]:
        cursor.execute(
            "INSERT OR IGNORE INTO domains (name, description) VALUES (?, ?)",
            (name, description),
        )


@app.route('/')
def index():
    """Public marketing landing page."""
    conn = get_db()
    stats = get_global_stats(conn)
    featured = conn.execute('''
        SELECT d.id, d.name, d.description, COUNT(t.id) as topic_count
        FROM domains d
        LEFT JOIN topics t ON d.id = t.domain_id
        GROUP BY d.id
        ORDER BY topic_count DESC, d.name
        LIMIT 3
    ''').fetchall()
    conn.close()
    return render_template('landing.html', stats=stats, featured=featured)


@app.route('/about')
def about():
    return render_template('about.html')


@app.route('/alldomains')
def all_domains():
    conn = get_db()
    domains = conn.execute('''
        SELECT d.*, COUNT(t.id) as topic_count 
        FROM domains d 
        LEFT JOIN topics t ON d.id = t.domain_id 
        GROUP BY d.id 
        ORDER BY d.name
    ''').fetchall()
    conn.close()
    return render_template('alldomains.html', domains=domains)


@app.route('/dashboard')
def dashboard():
    """User profile / dashboard.

    There is no auth layer yet, so the identity block is a placeholder while
    every figure below it is a real aggregate over the current database.
    """
    conn = get_db()
    stats = get_global_stats(conn)
    recent_topics = conn.execute('''
        SELECT t.id, t.name, d.name AS domain_name,
               COUNT(DISTINCT s.id) AS statement_count
        FROM topics t
        JOIN domains d ON t.domain_id = d.id
        LEFT JOIN statements s ON s.topic_id = t.id
        GROUP BY t.id
        ORDER BY t.created_at DESC
        LIMIT 6
    ''').fetchall()
    # The LIMIT is applied before the joins so only six attachment rows are
    # ever joined and sorted; ordering after the join would force a full scan
    # of `attachments` plus a temp b-tree sort on every dashboard load.
    recent_evidence = conn.execute('''
        SELECT a.title, a.type, a.filename,
               t.id AS topic_id, t.name AS topic_name
        FROM (
            SELECT id, statement_id, title, type, filename, created_at
            FROM attachments
            ORDER BY created_at DESC
            LIMIT 6
        ) a
        JOIN statements s ON a.statement_id = s.id
        JOIN topics t ON s.topic_id = t.id
        ORDER BY a.created_at DESC
    ''').fetchall()
    # Statements and attachments are pre-aggregated per topic so the deepest
    # table is not fanned out across the whole join; counting DISTINCT over
    # the full cross-product made this scale with total attachments rather
    # than with the handful of domains actually displayed.
    domain_breakdown = conn.execute('''
        SELECT d.id, d.name,
               COUNT(DISTINCT t.id) AS topic_count,
               COALESCE(SUM(ts.statement_count), 0) AS statement_count,
               COALESCE(SUM(ts.attachment_count), 0) AS attachment_count
        FROM domains d
        LEFT JOIN topics t ON t.domain_id = d.id
        LEFT JOIN (
            SELECT s.topic_id,
                   COUNT(DISTINCT s.id) AS statement_count,
                   COUNT(a.id) AS attachment_count
            FROM statements s
            LEFT JOIN attachments a ON a.statement_id = s.id
            GROUP BY s.topic_id
        ) ts ON ts.topic_id = t.id
        GROUP BY d.id
        ORDER BY topic_count DESC, d.name
    ''').fetchall()
    conn.close()
    return render_template(
        'dashboard.html',
        stats=stats,
        recent_topics=recent_topics,
        recent_evidence=recent_evidence,
        domain_breakdown=domain_breakdown,
        asset_kind=asset_kind,
    )

@app.route('/domain/<int:domain_id>')
def domain(domain_id):
    conn = get_db()
    domain = conn.execute('SELECT * FROM domains WHERE id = ?', (domain_id,)).fetchone()
    topic_rows = conn.execute('''
        SELECT t.*, 
               COUNT(DISTINCT s.id) as statement_count,
               COUNT(DISTINCT a.id) as attachment_count
        FROM topics t
        LEFT JOIN statements s ON t.id = s.topic_id
        LEFT JOIN attachments a ON s.id = a.statement_id
        WHERE t.domain_id = ?
        GROUP BY t.id
        ORDER BY t.created_at DESC
    ''', (domain_id,)).fetchall()
    conn.close()
    if not domain:
        flash('Domain not found')
        return redirect(url_for('all_domains'))
    return render_template('domain.html', domain=domain, topics=topic_rows)

@app.route('/topic/<int:topic_id>')
def topic(topic_id):
    conn = get_db()
    topic = conn.execute('''
        SELECT t.*, d.name as domain_name 
        FROM topics t 
        JOIN domains d ON t.domain_id = d.id 
        WHERE t.id = ?
    ''', (topic_id,)).fetchone()
    statements = conn.execute('SELECT * FROM statements WHERE topic_id = ? ORDER BY position ASC, created_at ASC', (topic_id,)).fetchall()
    statement_ids = [s['id'] for s in statements]
    if statement_ids:
        placeholders = ','.join('?' * len(statement_ids))
        attachments = conn.execute(f'SELECT * FROM attachments WHERE statement_id IN ({placeholders}) ORDER BY position ASC, created_at DESC', statement_ids).fetchall()
    else:
        attachments = []
    attachments_by_statement = {}
    for att in attachments:
        attachments_by_statement.setdefault(att['statement_id'], []).append(att)
    # Plain-dict version, keyed by string id, for JSON injection into the page so
    # the right-hand evidence pane can re-render on statement click. For text
    # kinds (link/richtext) the full body is large, so only the preview ships;
    # the modal/edit form fetch the full body on demand via /attachment/<id>.
    # For file-backed kinds the "content" is just a short URL, so it is kept.
    evidence_data = {
        str(sid): [
            {
                'id': a['id'],
                'statement_id': a['statement_id'],
                'title': a['title'],
                'type': a['type'],
                'kind': asset_kind(a['type'], a['filename']),
                'preview': preview_text(a['content']),
                'filename': a['filename'] or '',
                **({'content': a['content']} if a['type'] not in CONTENT_ONLY_TYPES else {}),
            }
            for a in atts
        ]
        for sid, atts in attachments_by_statement.items()
    }
    conn.close()
    if not topic:
        flash('Topic not found')
        return redirect(url_for('all_domains'))
    return render_template(
        'topic.html',
        topic=topic,
        statements=statements,
        attachments_by_statement=attachments_by_statement,
        evidence_data=evidence_data,
        evidence_summary=evidence_summary,
        asset_kind=asset_kind,
        preview_text=preview_text,
        CONTENT_ONLY_TYPES=CONTENT_ONLY_TYPES,
    )

@app.route('/create_topic', methods=['POST'])
def create_topic():
    domain_id = request.form.get('domain_id')
    name = request.form.get('name', '').strip()
    description = request.form.get('description', '').strip()
    if not domain_id or not name:
        flash('Domain and topic name are required')
        return redirect(request.referrer or url_for('all_domains'))
    conn = get_db()
    conn.execute('INSERT INTO topics (domain_id, name, description) VALUES (?, ?, ?)', (domain_id, name, description))
    conn.commit()
    topic_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    conn.close()
    return redirect(url_for('topic', topic_id=topic_id))

@app.route('/create_statement', methods=['POST'])
def create_statement():
    topic_id = request.form.get('topic_id')
    text = request.form.get('text', '').strip()
    if not topic_id or not text:
        flash('Statement text is required')
        return redirect(request.referrer or url_for('all_domains'))
    conn = get_db()
    conn.execute('INSERT INTO statements (topic_id, text, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM statements WHERE topic_id = ?))', (topic_id, text, topic_id))
    conn.commit()
    conn.close()
    return redirect(url_for('topic', topic_id=topic_id))

@app.route('/create_attachment', methods=['POST'])
def create_attachment():
    statement_id = request.form.get('statement_id')
    title = request.form.get('title', '').strip()
    att_type = request.form.get('type', 'link')
    content = request.form.get('content', '').strip()
    file = request.files.get('file')
    filename = None
    
    if not statement_id or not title:
        flash('Statement and title are required')
        return redirect(request.referrer or url_for('all_domains'))
    
    if att_type not in ASSET_TYPES:
        att_type = 'link'
    if att_type not in CONTENT_ONLY_TYPES and file and file.filename:
        ext = _upload_extension(att_type, file.filename)
        if ext is None:
            flash('That file type is not allowed for this asset type')
            return redirect(request.referrer or url_for('all_domains'))
        filename = f"{uuid.uuid4().hex}.{ext}"
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        content = filename
    elif att_type not in CONTENT_ONLY_TYPES and not content:
        # File-backed types may instead point at a URL (e.g. a YouTube video or
        # a hosted spreadsheet). Only reject when there is no file AND no URL,
        # which would otherwise store a row that renders as /uploads/<empty>.
        flash('A file or URL is required for this asset type')
        return redirect(request.referrer or url_for('all_domains'))
    
    conn = get_db()
    try:
        conn.execute(
            'INSERT INTO attachments (statement_id, title, type, content, filename, position) '
            'VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM attachments WHERE statement_id = ?))',
            (statement_id, title, att_type, content, filename, statement_id)
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        conn.close()
        flash('Could not save this attachment')
        return redirect(request.referrer or url_for('all_domains'))
    conn.close()
    return redirect(request.referrer or url_for('all_domains'))

@app.route('/update_statement', methods=['POST'])
def update_statement():
    statement_id = request.form.get('statement_id')
    text = request.form.get('text', '').strip()
    if not statement_id or not text:
        flash('Statement text is required')
        return redirect(request.referrer or url_for('all_domains'))
    conn = get_db()
    conn.execute('UPDATE statements SET text = ? WHERE id = ?', (text, statement_id))
    conn.commit()
    conn.close()
    return redirect(request.referrer or url_for('all_domains'))

@app.route('/reorder_statements/<int:topic_id>', methods=['POST'])
def reorder_statements(topic_id):
    # Receives the full ordered list of statement ids for the topic; each is
    # assigned a sequential position so the new order is authoritative.
    ordered = request.form.getlist('order')
    if not ordered:
        return redirect(request.referrer or url_for('all_domains'))
    conn = get_db()
    try:
        conn.executemany(
            'UPDATE statements SET position = ? WHERE id = ? AND topic_id = ?',
            [(idx, int(sid), topic_id) for idx, sid in enumerate(ordered)],
        )
        conn.commit()
    except (sqlite3.IntegrityError, ValueError):
        conn.rollback()
        conn.close()
        flash('Could not reorder statements')
        return redirect(request.referrer or url_for('all_domains'))
    conn.close()
    return redirect(request.referrer or url_for('all_domains'))

@app.route('/reorder_attachments/<int:statement_id>', methods=['POST'])
def reorder_attachments(statement_id):
    # Like reorder_statements but scoped to one statement's assets.
    ordered = request.form.getlist('order')
    if not ordered:
        return redirect(request.referrer or url_for('all_domains'))
    conn = get_db()
    try:
        conn.executemany(
            'UPDATE attachments SET position = ? WHERE id = ? AND statement_id = ?',
            [(idx, int(aid), statement_id) for idx, aid in enumerate(ordered)],
        )
        conn.commit()
    except (sqlite3.IntegrityError, ValueError):
        conn.rollback()
        conn.close()
        flash('Could not reorder assets')
        return redirect(request.referrer or url_for('all_domains'))
    conn.close()
    return redirect(request.referrer or url_for('all_domains'))

@app.route('/delete_statement/<int:statement_id>', methods=['POST'])
def delete_statement(statement_id):
    conn = get_db()
    # Collect files before the cascade removes the rows that reference them.
    rows = conn.execute(
        'SELECT filename FROM attachments WHERE statement_id = ? AND filename IS NOT NULL',
        (statement_id,)
    ).fetchall()
    conn.execute('DELETE FROM statements WHERE id = ?', (statement_id,))
    conn.commit()
    conn.close()
    for row in rows:
        _remove_upload(row['filename'])
    return redirect(request.referrer or url_for('all_domains'))

@app.route('/update_attachment', methods=['POST'])
def update_attachment():
    attachment_id = request.form.get('attachment_id')
    title = request.form.get('title', '').strip()
    att_type = request.form.get('type', '')
    content = request.form.get('content', '').strip()
    file = request.files.get('file')

    if not attachment_id or not title:
        flash('Attachment title is required')
        return redirect(request.referrer or url_for('all_domains'))

    conn = get_db()
    existing = conn.execute('SELECT * FROM attachments WHERE id = ?', (attachment_id,)).fetchone()
    if not existing:
        conn.close()
        flash('Attachment not found')
        return redirect(request.referrer or url_for('all_domains'))

    if att_type not in ASSET_TYPES:
        att_type = existing['type']

    filename = existing['filename']
    old_filename = existing['filename']

    if att_type not in CONTENT_ONLY_TYPES and file and file.filename:
        ext = _upload_extension(att_type, file.filename)
        if ext is None:
            conn.close()
            flash('That file type is not allowed for this asset type')
            return redirect(request.referrer or url_for('all_domains'))
        filename = f"{uuid.uuid4().hex}.{ext}"
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        content = filename
    elif att_type in CONTENT_ONLY_TYPES:
        # These types are content-only; drop any previously attached file.
        filename = None
        if not content:
            conn.close()
            flash('Content is required for this asset type')
            return redirect(request.referrer or url_for('all_domains'))
    elif old_filename:
        # File-backed type keeping its existing file. The edit form still
        # submits the (hidden) URL field, so never trust it to replace the
        # stored value; only fall back to the filename when content is empty
        # or the two already agree, so a legitimate label/URL is preserved.
        filename = old_filename
        if not content or content == existing['content']:
            content = existing['content'] or old_filename
    elif content:
        # File-backed type pointing at a URL rather than an upload (e.g. a
        # YouTube video). All three renderers support this filename-less state.
        filename = None
    else:
        # Neither a file, an existing file, nor a URL: this would persist a
        # corrupt row that renders as /uploads/<empty>.
        conn.close()
        flash('A file or URL is required for this asset type')
        return redirect(request.referrer or url_for('all_domains'))

    try:
        conn.execute(
            'UPDATE attachments SET title = ?, type = ?, content = ?, filename = ? WHERE id = ?',
            (title, att_type, content, filename, attachment_id)
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        conn.close()
        flash('Could not save this attachment')
        return redirect(request.referrer or url_for('all_domains'))
    conn.close()

    if old_filename and old_filename != filename:
        _remove_upload(old_filename)

    return redirect(request.referrer or url_for('all_domains'))


@app.route('/delete_attachment/<int:attachment_id>', methods=['POST'])
def delete_attachment(attachment_id):
    conn = get_db()
    row = conn.execute('SELECT filename FROM attachments WHERE id = ?', (attachment_id,)).fetchone()
    conn.execute('DELETE FROM attachments WHERE id = ?', (attachment_id,))
    conn.commit()
    conn.close()
    if row and row['filename']:
        _remove_upload(row['filename'])
    return redirect(request.referrer or url_for('all_domains'))


@app.route('/attachment/<int:attachment_id>')
def attachment(attachment_id):
    # Full content is fetched on demand so the initial topic page only ships
    # previews, not every richtext body. The modal and edit form call this.
    conn = get_db()
    row = conn.execute(
        'SELECT id, statement_id, title, type, content, filename FROM attachments WHERE id = ?',
        (attachment_id,)
    ).fetchone()
    conn.close()
    if not row:
        return {'error': 'not found'}, 404
    payload = {
        'id': row['id'],
        'statement_id': row['statement_id'],
        'title': row['title'],
        'type': row['type'],
        'kind': asset_kind(row['type'], row['filename']),
        'content': row['content'],
        'filename': row['filename'] or '',
    }
    return payload


def _remove_upload(filename):
    """Delete an uploaded file from disk, ignoring anything outside the upload dir."""
    if not filename:
        return
    upload_dir = os.path.realpath(app.config['UPLOAD_FOLDER'])
    path = os.path.realpath(os.path.join(upload_dir, filename))
    if os.path.commonpath([upload_dir, path]) != upload_dir:
        return
    try:
        os.remove(path)
    except OSError:
        pass


@app.route('/update_topic', methods=['POST'])
def update_topic():
    topic_id = request.form.get('topic_id')
    name = request.form.get('name', '').strip()
    description = request.form.get('description', '').strip()
    if not topic_id or not name:
        flash('Topic name is required')
        return redirect(request.referrer or url_for('all_domains'))
    conn = get_db()
    conn.execute('UPDATE topics SET name = ?, description = ? WHERE id = ?', (name, description, topic_id))
    conn.commit()
    conn.close()
    return redirect(request.referrer or url_for('all_domains'))

@app.route('/delete_topic/<int:topic_id>', methods=['POST'])
def delete_topic(topic_id):
    conn = get_db()
    # Collect files before the cascade removes the rows that reference them.
    rows = conn.execute('''
        SELECT a.filename FROM attachments a
        JOIN statements s ON a.statement_id = s.id
        WHERE s.topic_id = ? AND a.filename IS NOT NULL
    ''', (topic_id,)).fetchall()
    conn.execute('DELETE FROM topics WHERE id = ?', (topic_id,))
    conn.commit()
    conn.close()
    for row in rows:
        _remove_upload(row['filename'])
    return redirect(request.referrer or url_for('all_domains'))

@app.route('/update_domain', methods=['POST'])
def update_domain():
    domain_id = request.form.get('domain_id')
    name = request.form.get('name', '').strip()
    description = request.form.get('description', '').strip()
    if not domain_id or not name:
        flash('Domain name is required')
        return redirect(request.referrer or url_for('all_domains'))
    conn = get_db()
    conn.execute('UPDATE domains SET name = ?, description = ? WHERE id = ?', (name, description, domain_id))
    conn.commit()
    conn.close()
    return redirect(request.referrer or url_for('all_domains'))

@app.route('/delete_domain/<int:domain_id>', methods=['POST'])
def delete_domain(domain_id):
    conn = get_db()
    # `topics.domain_id` has no ON DELETE CASCADE, so with foreign keys enabled
    # the children must be removed explicitly or the delete is rejected.
    rows = conn.execute('''
        SELECT a.filename FROM attachments a
        JOIN statements s ON a.statement_id = s.id
        JOIN topics t ON s.topic_id = t.id
        WHERE t.domain_id = ? AND a.filename IS NOT NULL
    ''', (domain_id,)).fetchall()
    conn.execute('DELETE FROM topics WHERE domain_id = ?', (domain_id,))
    conn.execute('DELETE FROM domains WHERE id = ?', (domain_id,))
    conn.commit()
    conn.close()
    for row in rows:
        _remove_upload(row['filename'])
    return redirect(request.referrer or url_for('all_domains'))

@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    response = send_from_directory(app.config['UPLOAD_FOLDER'], filename)
    # Uploads are user-controlled: never let the browser sniff a different
    # content type, and keep them out of the page's script origin.
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Content-Security-Policy'] = "default-src 'none'; sandbox"
    return response

if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=10000)
else:
    # Under a WSGI server (gunicorn app:app) the __main__ guard never runs, so
    # the schema migration and bootstrapping must happen at import time or new
    # asset types raise an uncaught IntegrityError on their first insert.
    init_db()
