#!/usr/bin/env python3
"""
Kiosk-Agent — laeuft auf dem Raspberry Pi und verbindet ihn mit der
Verwaltungsplattform (Pull-Prinzip, funktioniert hinter NAT/Firewall).

Pro Zyklus:
  - POST {API}/api/agent/sync mit dem Geraete-Token (Heartbeat + Quittungen + Log)
  - empfaengt Seiten-Config -> schreibt sites.json NUR bei echter Aenderung,
    startet dann den Kiosk neu
  - fuehrt Befehle aus (restart_app, reboot, reload_config) und quittiert sie
    SOFORT (verhindert wiederholtes Ausfuehren / Neustart-Schleifen)
  - meldet Ereignisse (Start, Befehle, Neustarts, Fehler, Heartbeat) ans Dashboard
  - schaltet den Bildschirm nach Zeitplan an/aus (optional)

Konfiguration ueber Umgebungsvariablen (siehe kiosk-agent.env.example):
  KIOSK_API_URL, KIOSK_DEVICE_TOKEN, KIOSK_SITES_PATH, KIOSK_RESTART_CMD,
  KIOSK_POLL_SECONDS, KIOSK_OUTPUT, KIOSK_CURRENT_SITE_FILE
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
START_CMD = os.environ.get('KIOSK_START_CMD', 'systemctl --user start kiosk')
STOP_CMD = os.environ.get('KIOSK_STOP_CMD', 'systemctl --user stop kiosk')
POLL_SECONDS = int(os.environ.get('KIOSK_POLL_SECONDS', '15'))
OUTPUT = os.environ.get('KIOSK_OUTPUT', 'HDMI-A-1')
CURRENT_SITE_FILE = os.environ.get('KIOSK_CURRENT_SITE_FILE',
                                   os.path.expanduser('~/.cache/kiosk-current-site'))
AGENT_VERSION = '1.3'

_screen_on = None         # zuletzt gesetzter Bildschirm-Zustand
_pending_ack = []         # ausgefuehrte Befehle, beim naechsten Sync zu quittieren
_pending_logs = []        # Ereignisse fuers Dashboard, beim naechsten Sync uebermittelt


def log(msg, level='info'):
    print('[kiosk-agent] ' + msg, flush=True)
    _pending_logs.append({'level': level, 'message': msg})
    if len(_pending_logs) > 50:        # nicht unbegrenzt puffern (z.B. lange offline)
        del _pending_logs[:-50]


def read_current_site():
    try:
        with open(CURRENT_SITE_FILE, 'r', encoding='utf-8') as fh:
            return fh.read().strip() or None
    except OSError:
        return None


def sync(current_site):
    """Einen Sync-Zyklus durchfuehren; Antwort (dict) zurueckgeben."""
    global _pending_ack, _pending_logs
    payload = {
        'agent_version': AGENT_VERSION,
        'current_site': current_site,
        'ack': _pending_ack,
        'logs': _pending_logs,
    }
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(API_URL + '/api/agent/sync', data=data, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', 'Bearer ' + TOKEN)
    with urllib.request.urlopen(req, timeout=20) as resp:
        result = json.loads(resp.read().decode('utf-8'))
    _pending_ack = []   # erfolgreich uebermittelt
    _pending_logs = []
    return result


def _read_sites_file():
    try:
        with open(SITES_PATH, 'r', encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def write_sites(config):
    """sites.json schreiben, NUR wenn sich der Inhalt wirklich aendert.
    Vergleich gegen die DATEI (nicht den Speicher), damit ein Agent-Neustart
    keinen unnoetigen Kiosk-Neustart ausloest (= keine Neustart-Schleife)."""
    out = {
        'rotationInterval': config.get('rotationInterval', 15),
        'idleTimeout': config.get('idleTimeout', 5),
        'sites': config.get('sites', []),
    }
    if _read_sites_file() == out:
        return False
    text = json.dumps(out, ensure_ascii=False, indent=2)
    tmp = SITES_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(text + '\n')
    os.replace(tmp, SITES_PATH)  # atomar
    return True


def restart_kiosk():
    subprocess.run(RESTART_CMD, shell=True, check=False)


def run_command(cmd):
    """Plattform-Befehl ausfuehren. Gibt (status, result) zurueck.
    Status 'reboot' signalisiert: erst quittieren, DANN rebooten (sonst Reboot-Loop)."""
    t = cmd.get('type')
    try:
        if t in ('restart_app', 'reload_config'):
            restart_kiosk()
            return 'done', None
        if t == 'start_app':
            subprocess.run(START_CMD, shell=True, check=False)
            return 'done', None
        if t == 'stop_app':
            subprocess.run(STOP_CMD, shell=True, check=False)
            return 'done', None
        if t == 'reboot':
            return 'reboot', None
        return 'failed', 'unbekannter Befehl: %s' % t
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
        log('FEHLER: KIOSK_API_URL und KIOSK_DEVICE_TOKEN muessen gesetzt sein.', 'error')
        sys.exit(1)
    log('Agent gestartet (v%s), Poll alle %ss' % (AGENT_VERSION, POLL_SECONDS))
    sync_count = 0
    while True:
        try:
            result = sync(read_current_site())
            config = result.get('config', {})
            sync_count += 1
            if sync_count % 10 == 1:   # periodisches Lebenszeichen (~alle 10 Zyklen)
                log('Heartbeat — %d Seite(n) online' % len(config.get('sites', [])))

            if write_sites(config):
                log('Seiten-Konfiguration geaendert -> Kiosk neu laden')
                restart_kiosk()
            apply_schedule(config)

            commands = result.get('commands', [])
            reboot_after = False
            for cmd in commands:
                status, res = run_command(cmd)
                if status == 'reboot':
                    reboot_after = True
                    status, res = 'done', None
                log('Befehl ausgefuehrt: %s -> %s' % (cmd.get('type'), status))
                _pending_ack.append({'id': cmd.get('id'), 'status': status, 'result': res})

            if commands:
                # Sofort quittieren, damit Befehle nicht erneut geholt/ausgefuehrt werden.
                sync(read_current_site())
            if reboot_after:
                log('Reboot wird ausgefuehrt')
                subprocess.run('sudo reboot', shell=True, check=False)
        except urllib.error.URLError as exc:
            log('Netzwerkfehler: %s' % exc, 'error')
        except Exception as exc:  # noqa: BLE001
            log('Fehler: %s' % exc, 'error')
        time.sleep(POLL_SECONDS)


if __name__ == '__main__':
    main()
