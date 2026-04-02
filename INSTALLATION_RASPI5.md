# Kiosk-Display auf Raspberry Pi 5 installieren

## Voraussetzungen

- Raspberry Pi 5 (empfohlen: 4 GB RAM oder mehr)
- Raspberry Pi OS (64-bit, Bookworm) mit Desktop-Umgebung
- Bildschirm (z. B. Touchscreen oder Monitor via HDMI)
- Internetverbindung
- microSD-Karte (mind. 16 GB)

---

## 1. Raspberry Pi OS einrichten

Falls noch kein Betriebssystem installiert ist:

1. [Raspberry Pi Imager](https://www.raspberrypi.com/software/) herunterladen und auf dem PC starten
2. **Raspberry Pi OS (64-bit) with Desktop** auswählen
3. SD-Karte flashen und in den Pi einsetzen
4. Pi starten, WLAN und Sprache konfigurieren

---

## 2. System aktualisieren

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 3. Node.js installieren

Electron benötigt eine aktuelle Node.js-Version. Empfohlen: Node.js 20 LTS.

```bash
# NodeSource-Repository hinzufügen
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -

# Node.js installieren
sudo apt install -y nodejs

# Version prüfen
node -v
npm -v
```

---

## 4. Projekt auf den Pi kopieren

**Option A: Per Git klonen**

```bash
sudo apt install -y git
cd ~
git clone https://github.com/mercolutio/kiosk-display.git
```

**Option B: Per USB-Stick oder SCP kopieren**

```bash
# Beispiel mit SCP vom PC aus:
scp -r /pfad/zu/kiosk-display pi@<IP-DES-PI>:~/kiosk-display
```

---

## 5. Abhängigkeiten installieren

```bash
cd ~/kiosk-display
npm install
```

> **Hinweis:** Die Installation von Electron auf ARM64 kann einige Minuten dauern.

---

## 6. Webseiten konfigurieren

Die Datei `sites.json` enthält die Webseiten und das Rotationsintervall:

```bash
nano sites.json
```

Anpassen nach Bedarf:

```json
{
  "rotationInterval": 5,
  "idleTimeout": 5,
  "sites": [
    { "url": "https://example.com", "name": "Beispiel" }
  ]
}
```

---

## 7. Testlauf

```bash
# Im Fenstermodus testen
npm start

# Im Vollbildmodus starten
npm run start:fullscreen
```

Falls der Bildschirm im Hochformat (Portrait) betrieben wird, siehe Abschnitt "Bildschirm drehen" unten.

---

## 8. Autostart einrichten

Damit die Kiosk-Anwendung automatisch beim Hochfahren startet:

### Variante A: Autostart-Datei (Desktop)

```bash
mkdir -p ~/.config/autostart

cat > ~/.config/autostart/kiosk-display.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=Kiosk Display
Exec=/bin/bash -c "cd /home/$USER/kiosk-display && npm run start:fullscreen"
X-GNOME-Autostart-enabled=true
EOF
```

### Variante B: systemd-Service (empfohlen für Headless-Betrieb)

```bash
sudo cat > /etc/systemd/system/kiosk-display.service << EOF
[Unit]
Description=Kiosk Display Browser
After=graphical.target

[Service]
Type=simple
User=$USER
Environment=DISPLAY=:0
WorkingDirectory=/home/$USER/kiosk-display
ExecStart=/usr/bin/npm run start:fullscreen
Restart=on-failure
RestartSec=5

[Install]
WantedBy=graphical.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable kiosk-display
sudo systemctl start kiosk-display
```

Steuerung des Services:

```bash
sudo systemctl status kiosk-display   # Status anzeigen
sudo systemctl stop kiosk-display     # Stoppen
sudo systemctl restart kiosk-display  # Neustarten
journalctl -u kiosk-display -f        # Logs anzeigen
```

---

## 9. Bildschirm drehen (optional)

Falls der Bildschirm im Hochformat (Portrait) betrieben werden soll:

```bash
# /boot/firmware/config.txt bearbeiten
sudo nano /boot/firmware/config.txt

# Am Ende hinzufügen (90° Drehung):
display_rotate=1
```

Alternativ per `wlr-randr` (Wayland) oder `xrandr` (X11):

```bash
# X11
xrandr --output HDMI-1 --rotate right

# Wayland
wlr-randr --output HDMI-A-1 --transform 90
```

---

## 10. Energiesparmodus deaktivieren (optional)

Damit sich der Bildschirm nicht nach einiger Zeit abschaltet:

```bash
# Für X11 - Bildschirmschoner deaktivieren
xset s off
xset -dpms
xset s noblank

# Dauerhaft: in ~/.xinitrc oder ~/.xprofile eintragen
echo -e "xset s off\nxset -dpms\nxset s noblank" >> ~/.xprofile
```

---

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| `npm install` schlägt fehl | `sudo apt install -y build-essential` ausführen und erneut versuchen |
| Electron startet nicht | `export DISPLAY=:0` setzen, Desktop-Umgebung muss laufen |
| Weißer Bildschirm | Internetverbindung prüfen, URLs in `sites.json` überprüfen |
| Touch funktioniert nicht | Touchscreen-Treiber prüfen: `dmesg | grep -i touch` |
| Bildschirm geht in Standby | Siehe Abschnitt "Energiesparmodus deaktivieren" |

---

## Zusammenfassung (Schnellinstallation)

```bash
# Auf dem Raspberry Pi 5 ausführen:
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs git
cd ~
git clone https://github.com/mercolutio/kiosk-display.git
cd kiosk-display
npm install
npm run start:fullscreen
```
