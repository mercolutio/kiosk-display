# Kiosk-Display REST-API (v1)

Programmatischer Zugriff auf alles, was das Dashboard kann: Geräte, Seiten/Medien,
Fernsteuer-Befehle, Status und Statistik.

Basis-URL: `https://<dein-projekt>.vercel.app/api/v1` (bzw. eure Domain).

## Authentifizierung

Globaler Schlüssel aus der Env-Variable **`KIOSK_API_KEY`** (in Vercel setzen).
Mitschicken per Header **oder** Query-Parameter:

```
Authorization: Bearer <KIOSK_API_KEY>
# oder
?api_key=<KIOSK_API_KEY>
```

Ohne/falschen Schlüssel: `401`. Ist `KIOSK_API_KEY` nicht gesetzt: `503`.

Alle Beispiele nutzen die Variable:

```bash
export KIOSK_API="https://<dein-projekt>.vercel.app/api/v1"
export KEY="<KIOSK_API_KEY>"
```

## Geräte

```bash
# Auflisten
curl -H "Authorization: Bearer $KEY" "$KIOSK_API/devices"

# Anlegen (Adresse wird automatisch verortet)
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"KioskDisplay003","location":"Stadtmarkt 1, 38259 Salzgitter"}' \
  "$KIOSK_API/devices"
# -> { "device": { "id": "...", "token": "...", ... } }  (token = Agent-Token für den Pi)

# Einzeln (inkl. Token)
curl -H "Authorization: Bearer $KEY" "$KIOSK_API/devices/<id>"

# Ändern
curl -X PATCH -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"rotation_interval":20,"screen_off_time":"20:00","location":"Berliner Str. 44, 38226 Salzgitter"}' \
  "$KIOSK_API/devices/<id>"

# Löschen
curl -X DELETE -H "Authorization: Bearer $KEY" "$KIOSK_API/devices/<id>"
```

Änderbare Felder: `name`, `rotation_interval`, `idle_timeout`, `screen_on_time`,
`screen_off_time`, `remote_url`, `location` (auto-Verortung), `lat`/`lng` (Position direkt setzen).

## Seiten / Medien

```bash
# Auflisten
curl -H "Authorization: Bearer $KEY" "$KIOSK_API/devices/<id>/sites"

# Webseite hinzufügen
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Kunde X","url":"https://example.com","type":"web","duration":15}' \
  "$KIOSK_API/devices/<id>/sites"

# Ändern (z. B. deaktivieren / als nicht fakturiert markieren)
curl -X PATCH -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"enabled":false,"invoiced":false}' "$KIOSK_API/sites/<siteId>"

# Löschen
curl -X DELETE -H "Authorization: Bearer $KEY" "$KIOSK_API/sites/<siteId>"
```

Felder: `name`, `url`, `type` (`web|image|video`), `duration`, `enabled`, `invoiced`, `position`.

## Bild/Video hochladen

Datei als Roh-Body hochladen, dann die zurückgegebene `url` als Seite verwenden:

```bash
URL=$(curl -s -X POST -H "Authorization: Bearer $KEY" \
  --data-binary @plakat.jpg "$KIOSK_API/media?filename=plakat.jpg" | jq -r .url)

curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"name\":\"Aktion\",\"url\":\"$URL\",\"type\":\"image\",\"duration\":12}" \
  "$KIOSK_API/devices/<id>/sites"
```

## Fernsteuern

```bash
# Befehl senden: start_app | stop_app | restart_app | reboot | reload_config
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"type":"restart_app"}' "$KIOSK_API/devices/<id>/commands"

# Letzte Befehle + Status
curl -H "Authorization: Bearer $KEY" "$KIOSK_API/devices/<id>/commands"
```

Befehle landen in der Warteschlange und werden vom Pi-Agent beim nächsten Sync (~15 s) ausgeführt.

## Statistik

```bash
curl -H "Authorization: Bearer $KEY" "$KIOSK_API/devices/<id>/stats?days=7"
# -> { days, total_seconds, sites: [ { url, name, seconds, views, pauses, pause_seconds } ] }
```

## Hinweise

- Antworten sind JSON. Fehler: `{ "error": "..." }` mit passendem HTTP-Status.
- `GET /api/v1` liefert eine Übersicht aller Endpunkte (ebenfalls mit Key).
- Der `KIOSK_API_KEY` ist ein Vollzugriff-Schlüssel — nur serverseitig/sicher verwenden, nicht im Browser/Frontend ausliefern.
