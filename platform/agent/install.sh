#!/usr/bin/env bash
#
# Kiosk-Geraet einrichten (Electron-Variante).
# Holt Repo + Electron, installiert Agent + systemd-Services, traegt das
# Geraete-Token ein und startet alles.
#
# Voraussetzung: Raspberry Pi OS (Desktop, Wayland/labwc, Autologin), im Netz.
#
# Aufruf (interaktiv, fragt URL + Token ab):
#   bash ~/kiosk-display/platform/agent/install.sh
# Oder nicht-interaktiv:
#   KIOSK_API_URL=https://... KIOSK_DEVICE_TOKEN=xxxx bash install.sh
#
set -euo pipefail

REPO_URL="https://github.com/mercolutio/kiosk-display.git"
BRANCH="claude/gallant-thompson-RB2Fq"
DIR="$HOME/kiosk-display"

API_URL="${KIOSK_API_URL:-}"
TOKEN="${KIOSK_DEVICE_TOKEN:-}"
[ -z "$API_URL" ] && read -rp "Plattform-URL (z. B. https://kiosk-display-...vercel.app): " API_URL
[ -z "$TOKEN" ]   && read -rp "Geraete-Token (aus dem Dashboard): " TOKEN
if [ -z "$API_URL" ] || [ -z "$TOKEN" ]; then
  echo "FEHLER: API-URL und Token werden benoetigt." >&2
  exit 1
fi

echo "==> Node.js + git (falls noetig)"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi
command -v git >/dev/null 2>&1 || sudo apt install -y git

echo "==> Repo holen ($BRANCH)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch origin "$BRANCH"
  git -C "$DIR" checkout "$BRANCH"
  git -C "$DIR" pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$DIR"
fi

echo "==> Electron installieren (kann ein paar Minuten dauern)"
( cd "$DIR" && npm install )

echo "==> systemd-User-Services installieren"
mkdir -p "$HOME/.config/systemd/user"
cp "$DIR/platform/agent/kiosk.service"       "$HOME/.config/systemd/user/"
cp "$DIR/platform/agent/kiosk-agent.service" "$HOME/.config/systemd/user/"

echo "==> Agent-Konfiguration schreiben (~/.config/kiosk-agent.env)"
cat > "$HOME/.config/kiosk-agent.env" <<EOF
KIOSK_API_URL=$API_URL
KIOSK_DEVICE_TOKEN=$TOKEN
KIOSK_SITES_PATH=$DIR/sites.json
KIOSK_RESTART_CMD=systemctl --user restart kiosk
KIOSK_POLL_SECONDS=15
KIOSK_OUTPUT=HDMI-A-1
EOF

echo "==> Services aktivieren (linger = laeuft ohne Login)"
loginctl enable-linger "$USER" || true
systemctl --user daemon-reload
systemctl --user enable --now kiosk-agent.service
systemctl --user enable --now kiosk.service

echo ""
echo "==> Live-Fernsteuerung (Tailscale + VNC)"
SETUP_REMOTE="${KIOSK_REMOTE:-}"
if [ -z "$SETUP_REMOTE" ]; then
  read -rp "Jetzt einrichten (Bildschirm im Dashboard fernsteuern)? [J/n]: " ans
  case "$ans" in [nN]*) SETUP_REMOTE=0 ;; *) SETUP_REMOTE=1 ;; esac
fi
if [ "$SETUP_REMOTE" = "1" ]; then
  # Nicht-fatal: scheitert/abgebrochen -> Rest der Installation bleibt gueltig,
  # spaeter nachholbar mit setup-remote.sh.
  bash "$DIR/platform/agent/setup-remote.sh" \
    || echo "   Fernsteuerung uebersprungen/fehlgeschlagen — spaeter: bash $DIR/platform/agent/setup-remote.sh"
else
  echo "   Uebersprungen. Spaeter nachholbar: bash $DIR/platform/agent/setup-remote.sh"
fi

echo ""
echo "==> Fertig! Status:"
systemctl --user --no-pager status kiosk-agent | head -4 || true
echo ""
echo "Das Geraet sollte jetzt im Dashboard 'online' werden."
echo "Logs ansehen mit:  journalctl --user -u kiosk-agent -f"
