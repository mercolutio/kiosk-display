#!/usr/bin/env bash
#
# Live-Fernsteuerung auf einem Kiosk-Pi einrichten: Tailscale + wayvnc + noVNC.
# Danach ist der Bildschirm im Browser sichtbar UND steuerbar — sicher nur ueber
# dein Tailscale-Netz (gebunden an die Tailnet-IP, nicht offen im WLAN).
#
# Idempotent: kann gefahrlos erneut laufen (zum Nachruesten bestehender Geraete).
#
# Aufruf:
#   bash ~/kiosk-display/platform/agent/setup-remote.sh
# Nicht-interaktiv (z. B. fuer Flotten-Rollout) mit Tailscale-Auth-Key:
#   TS_AUTHKEY=tskey-auth-xxxx bash setup-remote.sh
#
set -euo pipefail

DIR="$HOME/kiosk-display"

echo "==> Pakete installieren (wayvnc, noVNC, websockify)"
sudo apt update
sudo apt install -y wayvnc novnc websockify

echo "==> Tailscale installieren (falls noetig)"
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

echo "==> Tailscale verbinden"
if [ -n "${TS_AUTHKEY:-}" ]; then
  sudo tailscale up --operator="$USER" --authkey="$TS_AUTHKEY"
else
  echo "    Falls gleich ein Login-Link erscheint: im Browser oeffnen und mit"
  echo "    DEINEM Tailscale-Konto bestaetigen (dann tritt der Pi deinem Netz bei)."
  sudo tailscale up --operator="$USER"
fi

echo "==> Warten auf Tailscale-IP ..."
until tailscale ip -4 >/dev/null 2>&1; do sleep 2; done
TSIP="$(tailscale ip -4 | head -1)"
echo "    Tailnet-IP: $TSIP"

echo "==> systemd-User-Services installieren (wayvnc + noVNC)"
mkdir -p "$HOME/.config/systemd/user"
cp "$DIR/platform/agent/wayvnc.service" "$HOME/.config/systemd/user/"
cp "$DIR/platform/agent/novnc.service"  "$HOME/.config/systemd/user/"
loginctl enable-linger "$USER" || true
systemctl --user daemon-reload
systemctl --user enable --now wayvnc.service
systemctl --user enable --now novnc.service

REMOTE_URL="http://$TSIP:6080/vnc.html?autoconnect=1&resize=remote"
echo ""
echo "=================================================================="
echo " Fertig! Fernsteuer-Adresse fuer das Dashboard:"
echo ""
echo "   $REMOTE_URL"
echo ""
echo " Diese Adresse im Dashboard beim Geraet eintragen unter:"
echo "   Einstellungen -> 'Fernsteuer-Adresse' -> Speichern"
echo " Danach erscheint dort der Knopf '🖥️ Fernsteuern'."
echo "=================================================================="
