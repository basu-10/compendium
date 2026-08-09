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
import glob
import logging

wsgi_logger = logging.getLogger('compendium.wsgi')
wsgi_logger.setLevel(logging.DEBUG)
_ws = logging.StreamHandler(sys.stderr)
_ws.setFormatter(logging.Formatter('%(asctime)s %(levelname)s [%(name)s] %(message)s'))
wsgi_logger.addHandler(_ws)

# The project is expected at /home/<username>/compendium. Derive the home dir
# from this file's real location so it works regardless of your account name.
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
USER_HOME = os.path.dirname(PROJECT_DIR)
VENV_DIR = os.path.join(USER_HOME, 'compendium-venv')

# Force the runtime data directory so the app reads/writes the DB you uploaded,
# regardless of the WSGI worker's current working directory.
DATA_DIR = os.path.join(USER_HOME, 'compendium-data')
os.environ['COMPANION_DATA_DIR'] = DATA_DIR

# Enable verbose debug logging in the WSGI worker so startup/venv/data problems
# are captured. Unset COMPANION_DEBUG (or set to empty) to silence file logging.
os.environ.setdefault('COMPANION_DEBUG', '1')

wsgi_logger.info('WSGI boot: PROJECT_DIR=%s USER_HOME=%s VENV_DIR=%s DATA_DIR=%s',
                 PROJECT_DIR, USER_HOME, VENV_DIR, DATA_DIR)
wsgi_logger.info('WSGI boot: venv exists=%s data_dir exists=%s db exists=%s',
                 os.path.isdir(VENV_DIR), os.path.isdir(DATA_DIR),
                 os.path.exists(os.path.join(DATA_DIR, 'compendium.db')))

if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

# Activate the project virtual environment. Modern venv does not ship
# `activate_this.py`, so fall back to adding the venv's site-packages to
# sys.path (the exact mechanism `activate_this.py` used to perform).
LEGACY_ACTIVATE = os.path.join(VENV_DIR, 'bin', 'activate_this.py')
if os.path.exists(LEGACY_ACTIVATE):
    wsgi_logger.info('WSGI boot: using legacy activate_this.py')
    with open(LEGACY_ACTIVATE) as _f:
        exec(_f.read(), {'__file__': LEGACY_ACTIVATE})
else:
    site_dirs = glob.glob(os.path.join(VENV_DIR, 'lib', 'python*', 'site-packages'))
    if not site_dirs:
        wsgi_logger.error('WSGI boot: NO venv site-packages found under %s', VENV_DIR)
    for _site in site_dirs:
        if _site not in sys.path:
            sys.path.insert(0, _site)
    wsgi_logger.info('WSGI boot: injected %d venv site-packages dir(s)', len(site_dirs))

# `app.py` runs init_db() at import time, so the SQLite schema is
# created/migrated on first request after a reload.
try:
    from app import app as application
    wsgi_logger.info('WSGI boot: app imported successfully')
except Exception as _boot_err:
    wsgi_logger.exception('WSGI boot: failed to import app: %s', _boot_err)
    raise
