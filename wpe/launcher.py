#!/usr/bin/env python3
"""
launcher.py — schlanker Kiosk-Launcher auf Basis von WebKitGTK (WebKit2).

Ersetzt Electron: WebKit ist deutlich genuegsamer beim RAM. Der Launcher
oeffnet ein Vollbildfenster, laedt die erste Seite aus sites.json und injiziert
drei User-Scripts in JEDE geladene Seite:

    1. window.__KIOSK_CONFIG__  (Inhalt von sites.json)
    2. kiosk-core.js            (reine Logik -> window.__KIOSK_CORE__)
    3. kiosk-overlay.js         (UI, Rotation, Cookie-Killer, Touch)

Die Rotation laeuft komplett im injizierten JS (location.href), daher braucht
der Launcher selbst keine Timer-Logik.

Abhaengigkeiten (Raspberry Pi OS / Debian):
    sudo apt install -y python3-gi gir1.2-gtk-3.0 \
        gir1.2-webkit2-4.1 libwebkit2gtk-4.1-0
    # (aelteres OS: gir1.2-webkit2-4.0 / libwebkit2gtk-4.0-37)

Start (Desktop/Dev):      python3 launcher.py --windowed
Start (Kiosk/Vollbild):   python3 launcher.py
"""

import argparse
import json
import os
import sys

import gi

gi.require_version('Gtk', '3.0')
# WebKit2-Version variiert je nach OS-Stand: zuerst 4.1, sonst 4.0.
try:
    gi.require_version('WebKit2', '4.1')
except ValueError:
    gi.require_version('WebKit2', '4.0')

from gi.repository import Gtk, WebKit2, Gdk  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

# Mobiler User-Agent -> Seiten rendern im Hochformat-Layout (wie Electron-Version).
MOBILE_UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
             'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 '
             'Mobile/15E148 Safari/604.1')


def read_text(path):
    with open(path, 'r', encoding='utf-8') as fh:
        return fh.read()


def build_user_content_manager(config):
    ucm = WebKit2.UserContentManager()

    scripts = [
        'window.__KIOSK_CONFIG__ = ' + json.dumps(config) + ';',
        read_text(os.path.join(HERE, 'kiosk-core.js')),
        read_text(os.path.join(HERE, 'kiosk-overlay.js')),
    ]
    for source in scripts:
        ucm.add_script(WebKit2.UserScript.new(
            source,
            WebKit2.UserContentInjectedFrames.TOP_FRAME,
            WebKit2.UserScriptInjectionTime.START,
            None, None,
        ))
    return ucm


def main():
    parser = argparse.ArgumentParser(description='Kiosk WPE/WebKitGTK Prototyp')
    parser.add_argument('--config', default=os.path.join(HERE, '..', 'sites.json'),
                        help='Pfad zu sites.json (Standard: ../sites.json)')
    parser.add_argument('--windowed', action='store_true',
                        help='Fenstermodus statt Vollbild (fuer Entwicklung)')
    args = parser.parse_args()

    config = json.loads(read_text(args.config))
    sites = config.get('sites', [])
    if not sites:
        sys.stderr.write('Keine Seiten in %s\n' % args.config)
        sys.exit(1)

    ucm = build_user_content_manager(config)
    webview = WebKit2.WebView.new_with_user_content_manager(ucm)

    settings = webview.get_settings()
    settings.set_user_agent(MOBILE_UA)
    settings.set_enable_developer_extras(True)

    window = Gtk.Window()
    window.set_default_size(768, 1366)
    window.connect('destroy', Gtk.main_quit)

    def on_key(_widget, event):
        # ESC beendet (Entwicklungs-Komfort)
        if event.keyval == Gdk.KEY_Escape:
            Gtk.main_quit()
        return False

    window.connect('key-press-event', on_key)
    window.add(webview)

    if not args.windowed:
        window.fullscreen()

    webview.load_uri(sites[0]['url'])
    window.show_all()
    Gtk.main()


if __name__ == '__main__':
    main()
