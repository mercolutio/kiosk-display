# Kiosk-Display — WPE/WebKit-Prototyp (Electron-Ersatz)

Schlanke Alternative zur Electron-Version, gedacht für RAM-arme Geräte wie den
**Raspberry Pi 3A+ (512 MB)**. Statt eines kompletten Chromium (Electron) läuft
hier eine **WebKit-Engine** und die gesamte Kiosk-Logik wird als JavaScript in
jede geladene Seite **injiziert**.

> **Status:** Prototyp. Kernlogik + Syntax sind getestet (`node wpe/test/...`).
> Rendering und tatsächlicher RAM-Verbrauch müssen noch **auf echter Pi-Hardware**
> verifiziert werden — das ging in der Build-Umgebung nicht (kein WebKit/Cog).

## Idee in einem Satz

WebKit lädt je eine Seite; ein injiziertes JS-Bundle bringt Overlay-UI, Rotation,
Cookie-Killer und Touch-Handling direkt in die Seite — **kein Electron, kein
zweiter UI-Prozess**.

## Dateien

| Datei | Zweck |
|---|---|
| `kiosk-core.js` | Reine Logik (URL→Index, next/prev, Anzeigedauer). In Node testbar. |
| `kiosk-overlay.js` | Injiziertes Bundle: Overlay-UI (Shadow-DOM), Rotation, Cookie-Killer, Interaktion/Idle, Touch-Scroll (optional), Bildschirmtastatur. |
| `launcher.py` | WebKitGTK-Launcher: Fenster + 3 User-Scripts injizieren + erste Seite laden. |
| `run-dev.sh` | Bequemer Dev-Start. |
| `test/kiosk-core.test.js` | Logik-Tests (ohne Framework). |

Die Konfiguration kommt aus der **bestehenden `../sites.json`** (kein Duplikat).

## Architektur / Rotation

Jeder Seitenwechsel ist ein voller Reload via `location.href` (wie schon in der
Electron-Version über `webview.src`). Es gibt **keine** persistente JS-Variable für
den aktuellen Index — der Index wird bei jedem Laden **aus der URL abgeleitet**
(`findIndexForUrl`). Die URL ist also der Zustand; das überlebt Reloads ohne Tricks.

- Bekannte Seite geladen → Timer läuft, nach Ablauf `location.href = nextSite`.
- Externer Link (unbekannter Host) → **keine** Auto-Rotation (Nutzer kann lesen),
  Pfeile/Dots bringen zurück in die Rotation.

## Schnelltest der Logik (überall, nur Node nötig)

```bash
node wpe/test/kiosk-core.test.js
```

## Auf einem Linux-Desktop ausprobieren

```bash
sudo apt install -y python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 libwebkit2gtk-4.1-0
./wpe/run-dev.sh --windowed     # Fenster
./wpe/run-dev.sh                # Vollbild  (ESC beendet)
```

## Auf dem Raspberry Pi 3A+ (512 MB)

Ziel: **Raspberry Pi OS Lite** (ohne Desktop) + minimaler Kiosk-Compositor `cage`.
Das spart gegenüber dem vollen Desktop spürbar RAM.

```bash
sudo apt update
sudo apt install -y python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 \
                    libwebkit2gtk-4.1-0 cage
# (älteres OS: gir1.2-webkit2-4.0 / libwebkit2gtk-4.0-37)

git clone https://github.com/mercolutio/kiosk-display.git
cd kiosk-display

# Kiosk-Vollbild unter cage starten:
cage -- python3 wpe/launcher.py
```

Autostart als systemd-Service (analog zu `INSTALLATION_RASPI5.md`, aber `cage`
statt Electron):

```ini
# /etc/systemd/system/kiosk-wpe.service
[Unit]
Description=Kiosk WPE Display
After=systemd-user-sessions.service

[Service]
User=pi
Environment=XDG_RUNTIME_DIR=/run/user/1000
ExecStart=/usr/bin/cage -- /usr/bin/python3 /home/pi/kiosk-display/wpe/launcher.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## RAM messen (auf dem Pi)

```bash
free -m                       # Gesamtüberblick
sudo apt install -y smem      # genauer pro Prozess (PSS):
smem -t -k -P 'WebKit|cage|launcher'
```

Wenn es trotz `cage` zu eng wird → nächster Schritt: **Cog/WPE direkt auf
KMS/DRM** (ganz ohne Compositor). Dafür dasselbe Bundle als WebKit-Web-Extension
injizieren; Paketnamen (`cog`, `libwpewebkit-*`) variieren je OS-Stand und werden
am besten gegen die installierte Version festgezurrt.

## Bekannte Einschränkungen (für die Hardware-Verifikation)

- **CSP/Styling:** Das Overlay nutzt Shadow-DOM + Constructable-Stylesheets, um die
  CSP strenger Seiten zu umgehen. Auf einzelnen Seiten kann Feintuning nötig sein.
- **Overlay überlagert** oben/unten je 44 px der Seite (HUD-Prinzip, reserviert
  keinen Platz), um fremde Layouts nicht zu zerschießen.
- **Touch-Scroll:** Standardmäßig wird natives WebKit-Scrolling genutzt
  (`ENABLE_SCROLL_SIM = false` in `kiosk-overlay.js`). Falls die Hardware kein
  natives Touch-Scroll liefert, auf `true` setzen.
- **Bildschirmtastatur** ist bewusst einfach (tippt in das fokussierte Feld) und
  der am wenigsten seitenübergreifend robuste Teil.
- **Kein Offline-Betrieb** — wie gewünscht: Inhalte kommen live aus dem Netz.
