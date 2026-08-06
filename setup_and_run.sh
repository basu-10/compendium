#!/usr/bin/env bash
set -e

VENV_DIR="venv"
REQUIREMENTS="requirements.txt"
APP_FILE="app.py"

if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
    echo "Installing dependencies..."
    "$VENV_DIR/bin/pip" install --upgrade pip
    "$VENV_DIR/bin/pip" install -r "$REQUIREMENTS"
else
    echo "Virtual environment found."
fi

echo "Starting Flask app..."
exec "$VENV_DIR/bin/python" "$APP_FILE"
