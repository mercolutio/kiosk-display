#!/usr/bin/env bash
# Dev-Start auf einem Linux-Desktop (benoetigt WebKitGTK + PyGObject).
# Beispiele:
#   ./run-dev.sh --windowed
#   ./run-dev.sh                 # Vollbild
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$DIR/launcher.py" "$@"
