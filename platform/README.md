# Kiosk-Verwaltungsplattform

Web-Admin (Next.js auf Vercel) + Postgres + ein schlanker **Pi-Agent**, um
Kiosk-Geräte aus der Ferne zu verwalten: Webseiten pflegen, neu starten/rebooten,
Status sehen, Bildschirm-Zeitplan.

## Architektur (warum Pull?)

Der Pi hängt hinter NAT/Firewall und ist von außen nicht erreichbar. Deshalb
**fragt der Pi die Cloud aktiv ab** (ausgehende HTTPS-Verbindung — geht überall):

```
   Browser ─▶ Web-Admin (Vercel) ─▶ Postgres
                                       ▲
                       Pi-Agent  POST /api/agent/sync  (alle ~15s)
                                       │
                              schreibt sites.json, startet Kiosk neu,
                              führt Befehle aus, meldet Heartbeat
```

## Stand (Increment 1)

✅ Datenmodell (`db/schema.sql`), Sync-API (`app/api/agent/sync`), Pi-Agent
(`agent/`).
🔜 Increment 2: Login + Dashboard/Editor-UI + Admin-API, dann Deploy.

## Datenmodell

- **devices** — je ein Kiosk (Name, Geheim-Token, Fallback-Dauer, Idle-Timeout,
  optionaler Bildschirm-Zeitplan, Heartbeat, gemeldete aktuelle Seite)
- **sites** — geordnete Webseiten je Gerät (Name, URL, Dauer, Position, aktiv)
- **commands** — Befehlswarteschlange je Gerät (`restart_app` | `reboot` |
  `reload_config`), wird vom Agent abgeholt und quittiert

## Cloud aufsetzen (Kurzfassung — Details in Increment 2)

1. In Vercel ein Projekt anlegen, **Root Directory = `platform`**.
2. Im Projekt unter **Storage** eine Postgres-Datenbank verbinden → setzt
   `POSTGRES_URL`.
3. `ADMIN_PASSWORD` und `SESSION_SECRET` als Env-Variablen setzen.
4. `db/schema.sql` einmalig gegen die DB ausführen.

## Pi-Agent einrichten (auf dem Raspberry Pi)

Voraussetzung: Repo liegt unter `~/kiosk-display`, der Kiosk läuft als
user-systemd-Service.

```bash
# 1) Kiosk als user-Service (statt Autostart-.desktop):
mkdir -p ~/.config/systemd/user
cp ~/kiosk-display/platform/agent/kiosk.service       ~/.config/systemd/user/
cp ~/kiosk-display/platform/agent/kiosk-agent.service ~/.config/systemd/user/

# 2) Agent-Konfiguration:
cp ~/kiosk-display/platform/agent/kiosk-agent.env.example ~/.config/kiosk-agent.env
nano ~/.config/kiosk-agent.env      # API-URL + Geraete-Token eintragen

# 3) Aktivieren (lingering, damit es ohne Login laeuft):
loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now kiosk.service
systemctl --user enable --now kiosk-agent.service

# Logs:
journalctl --user -u kiosk-agent -f
```

> Damit der alte Autostart nicht zusätzlich startet:
> `mv ~/.config/autostart/kiosk-display.desktop ~/.config/autostart/kiosk-display.desktop.bak`
> (bei dir bereits erledigt).

## Sync-Protokoll

`POST /api/agent/sync`, Header `Authorization: Bearer <device_token>`

```jsonc
// Request
{ "agent_version": "1.0", "current_site": "https://…",
  "ack": [ { "id": "…", "status": "done", "result": null } ] }

// Response
{ "device": { "name": "…" },
  "config": { "rotationInterval": 15, "idleTimeout": 5,
              "screenOnTime": "07:00", "screenOffTime": "20:00",
              "sites": [ { "url": "…", "name": "…", "duration": 20 } ] },
  "commands": [ { "id": "…", "type": "restart_app" } ] }
```
