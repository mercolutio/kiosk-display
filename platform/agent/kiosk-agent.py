#!/usr/bin/env python3
"""
Kiosk-Agent — laeuft auf dem Raspberry Pi und verbindet ihn mit der
Verwaltungsplattform (Pull-Prinzip, funktioniert hinter NAT/Firewall).

Pro Zyklus:
  - POST {API}/api/agent/sync mit dem Geraete-Token (Heartbeat + Quittungen)
  - empfaengt Seiten-Config -> schreibt sites.json, startet bei Aenderung den Kiosk neu
  - fuehrt Befehle aus (restart_app, reboot, reload_config) und quittiert sie
  - schaltet den Bildschirm nach Zeitplan an/aus (optional)

Konfiguration ueber Umgebungsvariablen (siehe kiosk-agent.env.example):
  KIOSK_API_URL          z.B. https://dein-projekt.vercel.app
  KIOSK_DEVICE_TOKEN     Geheim-Token des Geraets (aus der Plattform)
  KIOSK_SITES_PATH       Pfad zur sites.json (Default: ~/kiosk-display/sites.json)
  KIOSK_RESTART_CMD      Kiosk-Neustart (Default: systemctl --user restart kiosk)
  KIOSK_POLL_SECONDS     Poll-Intervall (Default: 15)
  KIOSK_OUTPUT           Display-Output fuer die Zeitsteuerung (Default: HDMI-A-1)
  KIOSK_CURRENT_SITE_FILE  Optional: Datei, in die der Kiosk die aktuelle Seite schreibt
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, time as dtime

API_URL = os.environ.get('KIOSK_API_URL', '').rstrip('/')
TOKEN = os.environ.get('KIOSK_DEVICE_TOKEN', '')
SITES_PATH = os.environ.get('KIOSK_SITES_PATH', os.path.expanduser('~/kiosk-display/sites.json'))
RESTART_CMD = os.environ.get('KIOSK_RESTART_CMD', 'systemctl --user restart kiosk')
POLL_SECONDS = int(os.environ.get('KIOSK_POLL_SECONDS', '15'))
OUTPUT = os.environ.get('KIOSK_OUTPUT', 'HDMI-A-1')
CURRENT_SITE_FILE = os.environ.get('KIOSK_CURRENT_SITE_FILE',
                                   os.path.expanduser('~/.cache/kiosk-current-site'))
AGENT_VERSION = '1.0'

_last_sites_json = None   # zuletzt geschriebene sites.json (Aenderungsvergleich)
_screen_on = None         # zuletzt gesetzter Bildschirm-Zustand
_pending_ack = []         # ausgefuehrte Befehle, beim naechsten Sync zu quittieren


def log(msg):
    print('[kiosk-agent] ' + msg, flush=True)


def read_current_site():
    try:
        with open(CURRENT_SITE_FILE, 'r', encoding='utf-8') as fh:
            return fh.read().strip() or None
    except OSError:
        return None


def sync(current_site):
    """Einen Sync-Zyklus durchfuehren; Antwort (dict) zurueckgeben."""
    global _pending_ack
    payload = {'agent_version': AGENT_VERSION, 'current_site': current_site, 'ack': _pending_ack}
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(API_URL + '/api/agent/sync', data=data, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', 'Bearer ' + TOKEN)
    with urllib.request.urlopen(req, timeout=20) as resp:
        result = json.loads(resp.read().decode('utf-8'))
    _pending_ack = []  # erfolgreich uebermittelt
    return result


def write_sites(config):
    """sites.json im vom Kiosk erwarteten Format schreiben. True bei Aenderung."""
    global _last_sites_json
    out = {
        'rotationInterval': config.get('rotationInterval', 15),
        'idleTimeout': config.get('idleTimeout', 5),
        'sites': config.get('sites', []),
    }
    text = json.dumps(out, ensure_ascii=False, indent=2)
    if text == _last_sites_json:
        return False
    tmp = SITES_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(text + '\n')
    os.replace(tmp, SITES_PATH)  # atomar
    _last_sites_json = text
    return True


def restart_kiosk():
    log('Kiosk neu starten: ' + RESTART_CMD)
    subprocess.run(RESTART_CMD, shell=True, check=False)


def run_command(cmd):
    """Plattform-Befehl ausfuehren; (status, result) zurueckgeben."""
    t = cmd.get('type')
    try:
        if t in ('restart_app', 'reload_config'):
            restart_kiosk()
        elif t == 'reboot':
            subprocess.run('sudo reboot', shell=True, check=False)
        else:
            return 'failed', 'unbekannter Befehl: %s' % t
        return 'done', None
    except Exception as exc:  # noqa: BLE001
        return 'failed', str(exc)


def _wayland_env():
    env = dict(os.environ)
    env.setdefault('WAYLAND_DISPLAY', 'wayland-0')
    env.setdefault('XDG_RUNTIME_DIR', '/run/user/%d' % os.getuid())
    return env


def set_screen(on):
    global _screen_on
    if on == _screen_on:
        return
    arg = '--on' if on else '--off'
    log('Bildschirm %s' % ('AN' if on else 'AUS'))
    subprocess.run(['wlr-randr', '--output', OUTPUT, arg], env=_wayland_env(), check=False)
    _screen_on = on


def _parse_time(value):
    """'HH:MM' oder 'HH:MM:SS' -> datetime.time, sonst None."""
    if not value:
        return None
    try:
        parts = [int(p) for p in str(value).split(':')]
        while len(parts) < 3:
            parts.append(0)
        return dtime(parts[0], parts[1], parts[2])
    except (ValueError, IndexError):
        return None


def apply_schedule(config):
    on_t = _parse_time(config.get('screenOnTime'))
    off_t = _parse_time(config.get('screenOffTime'))
    if not on_t or not off_t:
        return  # keine Zeitsteuerung konfiguriert
    now = datetime.now().time()
    if on_t <= off_t:
        should_on = on_t <= now < off_t
    else:  # ueber Mitternacht (z.B. an 20:00, aus 06:00)
        should_on = now >= on_t or now < off_t
    set_screen(should_on)


def main():
    if not API_URL or not TOKEN:
        log('FEHLER: KIOSK_API_URL und KIOSK_DEVICE_TOKEN muessen gesetzt sein.')
        sys.exit(1)
    log('Start. API=%s Poll=%ss' % (API_URL, POLL_SECONDS))
    while True:
        try:
            result = sync(read_current_site())
            config = result.get('config', {})
            if write_sites(config):
                log('sites.json aktualisiert -> Kiosk neu laden')
                restart_kiosk()
            apply_schedule(config)
            for cmd in result.get('commands', []):
                log('Befehl: %s' % cmd.get('type'))
                status, res = run_command(cmd)
                _pending_ack.append({'id': cmd.get('id'), 'status': status, 'result': res})
        except urllib.error.URLError as exc:
            log('Netzwerkfehler: %s' % exc)
        except Exception as exc:  # noqa: BLE001
            log('Fehler: %s' % exc)
        time.sleep(POLL_SECONDS)


if __name__ == '__main__':
    main()
