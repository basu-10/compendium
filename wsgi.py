"""
PythonAnywhere WSGI entry point for Compendium.

Place this file at /var/www/<username>_pythonanywhere_com_wsgi.py (or paste its
contents into the WSGI file shown in the PythonAnywhere "Web" tab).

Replace <username> with your PythonAnywhere account name.
"""

import sys
import os

PROJECT_DIR = '/home/<username>/compendium'
VENV_ACTIVATE = os.path.join(os.path.dirname(PROJECT_DIR), 'compendium-venv', 'bin', 'activate_this.py')

if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

# Activate the project virtual environment.
with open(VENV_ACTIVATE) as _f:
    exec(_f.read(), {'__file__': VENV_ACTIVATE})

# `app.py` runs init_db() at import time (via its __main__ guard's else branch),
# so the SQLite schema is created/migrated on first request after a reload.
from app import app as application
