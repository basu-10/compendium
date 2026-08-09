"""
PythonAnywhere WSGI entry point for Compendium.

Paste this entire file into the WSGI file shown in the PythonAnywhere "Web" tab
(replacing its contents), after replacing <username> with your account name.

It activates the external virtual environment (compendium-venv) and ensures the
app reads the database from the external compendium-data directory.
"""

import sys
import os

USERNAME = '<username>'
PROJECT_DIR = '/home/%s/compendium' % USERNAME
VENV_ACTIVATE = '/home/%s/compendium-venv/bin/activate_this.py' % USERNAME
# Force the runtime data directory so the app reads/writes the DB you uploaded,
# regardless of the WSGI worker's current working directory.
os.environ['COMPANION_DATA_DIR'] = '/home/%s/compendium-data' % USERNAME

if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

# Activate the project virtual environment.
with open(VENV_ACTIVATE) as _f:
    exec(_f.read(), {'__file__': VENV_ACTIVATE})

# `app.py` runs init_db() at import time, so the SQLite schema is
# created/migrated on first request after a reload.
from app import app as application
