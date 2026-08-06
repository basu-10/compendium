from flask import Flask, render_template, request, redirect, url_for, flash, send_from_directory
import sqlite3
import os
import uuid

app = Flask(__name__)
app.secret_key = 'compendium-secret-key-change-in-production'
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max upload

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'compendium.db')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

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
            type TEXT NOT NULL CHECK (type IN ('link', 'document', 'image', 'video', 'text')),
            content TEXT NOT NULL,
            filename TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (statement_id) REFERENCES statements (id) ON DELETE CASCADE
        );
    ''')
    
    cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='attachments'")
    existing = cursor.fetchone()
    if existing and 'text' not in existing[0]:
        cursor.execute('''CREATE TABLE attachments_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            statement_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('link', 'document', 'image', 'video', 'text')),
            content TEXT NOT NULL,
            filename TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (statement_id) REFERENCES statements (id) ON DELETE CASCADE
        )''')
        cursor.execute('INSERT INTO attachments_new SELECT id, statement_id, title, type, content, filename, created_at FROM attachments')
        cursor.execute('DROP TABLE attachments')
        cursor.execute('ALTER TABLE attachments_new RENAME TO attachments')
    
    cursor.execute('SELECT COUNT(*) FROM domains')
    if cursor.fetchone()[0] == 0:
        cursor.executemany('INSERT INTO domains (name, description) VALUES (?, ?)', [
            ('Computer Science', 'Architecture, backend dev, AI implementations, and databases.'),
            ('Markets & Economics', 'Macro analysis, company 10-K reports, and asset classes.'),
            ('Literature & Society', 'Classic texts, parallel readings, and sociopolitical deep dives.')
        ])
    
    conn.commit()
    conn.close()

@app.route('/')
def index():
    conn = get_db()
    domains = conn.execute('''
        SELECT d.*, COUNT(t.id) as topic_count 
        FROM domains d 
        LEFT JOIN topics t ON d.id = t.domain_id 
        GROUP BY d.id 
        ORDER BY d.name
    ''').fetchall()
    conn.close()
    return render_template('main.html', domains=domains)

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
        return redirect(url_for('index'))
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
    statements = conn.execute('SELECT * FROM statements WHERE topic_id = ? ORDER BY created_at ASC', (topic_id,)).fetchall()
    statement_ids = [s['id'] for s in statements]
    if statement_ids:
        placeholders = ','.join('?' * len(statement_ids))
        attachments = conn.execute(f'SELECT * FROM attachments WHERE statement_id IN ({placeholders}) ORDER BY created_at DESC', statement_ids).fetchall()
    else:
        attachments = []
    attachments_by_statement = {}
    for att in attachments:
        attachments_by_statement.setdefault(att['statement_id'], []).append(att)
    conn.close()
    if not topic:
        flash('Topic not found')
        return redirect(url_for('index'))
    return render_template('topic.html', topic=topic, statements=statements, attachments_by_statement=attachments_by_statement)

@app.route('/create_topic', methods=['POST'])
def create_topic():
    domain_id = request.form.get('domain_id')
    name = request.form.get('name', '').strip()
    description = request.form.get('description', '').strip()
    if not domain_id or not name:
        flash('Domain and topic name are required')
        return redirect(request.referrer or url_for('index'))
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
        return redirect(request.referrer or url_for('index'))
    conn = get_db()
    conn.execute('INSERT INTO statements (topic_id, text) VALUES (?, ?)', (topic_id, text))
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
        return redirect(request.referrer or url_for('index'))
    
    if att_type != 'link' and file and file.filename:
        ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
        filename = f"{uuid.uuid4().hex}.{ext}"
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        content = filename
    
    conn = get_db()
    conn.execute('INSERT INTO attachments (statement_id, title, type, content, filename) VALUES (?, ?, ?, ?, ?)',
                 (statement_id, title, att_type, content, filename))
    conn.commit()
    conn.close()
    return redirect(request.referrer or url_for('index'))

@app.route('/update_statement', methods=['POST'])
def update_statement():
    statement_id = request.form.get('statement_id')
    text = request.form.get('text', '').strip()
    if not statement_id or not text:
        flash('Statement text is required')
        return redirect(request.referrer or url_for('index'))
    conn = get_db()
    conn.execute('UPDATE statements SET text = ? WHERE id = ?', (text, statement_id))
    conn.commit()
    conn.close()
    return redirect(request.referrer or url_for('index'))

@app.route('/delete_statement/<int:statement_id>', methods=['POST'])
def delete_statement(statement_id):
    conn = get_db()
    conn.execute('DELETE FROM statements WHERE id = ?', (statement_id,))
    conn.commit()
    conn.close()
    return redirect(request.referrer or url_for('index'))

@app.route('/update_topic', methods=['POST'])
def update_topic():
    topic_id = request.form.get('topic_id')
    name = request.form.get('name', '').strip()
    description = request.form.get('description', '').strip()
    if not topic_id or not name:
        flash('Topic name is required')
        return redirect(request.referrer or url_for('index'))
    conn = get_db()
    conn.execute('UPDATE topics SET name = ?, description = ? WHERE id = ?', (name, description, topic_id))
    conn.commit()
    conn.close()
    return redirect(request.referrer or url_for('index'))

@app.route('/delete_topic/<int:topic_id>', methods=['POST'])
def delete_topic(topic_id):
    conn = get_db()
    conn.execute('DELETE FROM topics WHERE id = ?', (topic_id,))
    conn.commit()
    conn.close()
    return redirect(request.referrer or url_for('index'))

@app.route('/update_domain', methods=['POST'])
def update_domain():
    domain_id = request.form.get('domain_id')
    name = request.form.get('name', '').strip()
    description = request.form.get('description', '').strip()
    if not domain_id or not name:
        flash('Domain name is required')
        return redirect(request.referrer or url_for('index'))
    conn = get_db()
    conn.execute('UPDATE domains SET name = ?, description = ? WHERE id = ?', (name, description, domain_id))
    conn.commit()
    conn.close()
    return redirect(request.referrer or url_for('index'))

@app.route('/delete_domain/<int:domain_id>', methods=['POST'])
def delete_domain(domain_id):
    conn = get_db()
    conn.execute('DELETE FROM domains WHERE id = ?', (domain_id,))
    conn.commit()
    conn.close()
    return redirect(request.referrer or url_for('index'))

@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=10000)
