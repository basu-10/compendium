"""
PythonAnywhere WSGI entry point for Compendium.

Paste this entire file into the WSGI file shown in the PythonAnywhere "Web" tab
(replacing its contents). It derives your home directory from the actual
filesystem path, so you do NOT need to edit the username by hand. It then
activates the external virtual environment (compendium-venv) and points the app
at the external compendium-data directory so it uses the database you uploaded.

If you previously saw an error about a missing `activate_this.py`, that file is
no longer created by modern `venv`. This script falls back to injecting the
venv's site-packages onto sys.path directly, which works on current
PythonAnywhere images.
"""

import os
import sys

# The project is expected at /home/<username>/compendium. Derive the home dir
# from this file's real location so it works regardless of your account name.
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
USER_HOME = os.path.dirname(PROJECT_DIR)
VENV_DIR = os.path.join(USER_HOME, 'compendium-venv')

# Force the runtime data directory so the app reads/writes the DB you uploaded,
# regardless of the WSGI worker's current working directory.
DATA_DIR = os.path.join(USER_HOME, 'compendium-data')
os.environ['COMPANION_DATA_DIR'] = DATA_DIR

if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

# Activate the project virtual environment. Modern venv does not ship
# `activate_this.py`, so fall back to adding the venv's site-packages to
# sys.path (the exact mechanism `activate_this.py` used to perform).
LEGACY_ACTIVATE = os.path.join(VENV_DIR, 'bin', 'activate_this.py')
if os.path.exists(LEGACY_ACTIVATE):
    with open(LEGACY_ACTIVATE) as _f:
        exec(_f.read(), {'__file__': LEGACY_ACTIVATE})
else:
    import glob
    site_dirs = glob.glob(os.path.join(VENV_DIR, 'lib', 'python*', 'site-packages'))
    for _site in site_dirs:
        if _site not in sys.path:
            sys.path.insert(0, _site)

# `app.py` runs init_db() at import time, so the SQLite schema is
# created/migrated on first request after a reload.
from app import app as application
