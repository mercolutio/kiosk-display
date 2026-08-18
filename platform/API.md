# kiosk-display REST-API (v1)

Vollzugriff auf die Kiosk-Verwaltung für externe Tools und Assistenten
(z. B. einen WhatsApp-AI-Assistenten): Geräteflotte, Seiten/Medien, Befehle,
Statistik, Verträge und Rechnungen inkl. E-Rechnung.

- **Basis-URL:** `https://flotte.microwerbung.com/api/v1`
- **Auth:** jeder Aufruf mit `Authorization: Bearer <API_KEY>`
  (alternativ `?api_key=<API_KEY>` — nur nutzen, wo keine Header möglich sind;
  Keys in URLs landen in Logs).
- **Keys:** Env-Variablen in Vercel — `KIOSK_API_KEY` (Haupt-Key) und optional
  `KIOSK_API_KEYS` (kommagetrennt, ein Key **pro Client**, einzeln widerrufbar).
- **Format:** JSON (UTF-8); Datumsangaben `YYYY-MM-DD`; Beträge in Euro (netto,
  sofern nicht anders angegeben).

```bash
curl -sS https://flotte.microwerbung.com/api/v1/summary \
  -H "Authorization: Bearer $API_KEY"
```

## Übersicht (für Assistenten)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/summary` | Gesamtlage in einem Aufruf: Geräte online/App an, Kunden + MRR, offene/überfällige Rechnungen |

Antwort (gekürzt):

```json
{
  "devices":   { "total": 4, "online": 4, "app_active": 3, "list": [ { "id": "…", "name": "KioskDisplay001", "online": true, "app_active": true, "location": "…" } ] },
  "customers": { "total": 5, "mrr": 99.5, "list": [ { "name": "Bäckerei Müller", "displays": 2, "billed": 2, "mrr": 39.8 } ] },
  "invoices":  { "open_count": 1, "open_sum": 284.17, "overdue_count": 0, "paid_this_year": 512.4, "drafts": 2 }
}
```

## Geräte

| Methode | Pfad | Body / Parameter |
|---|---|---|
| GET | `/devices` | — |
| POST | `/devices` | `{ "name": "KioskDisplay005", "location"?: "Adresse" }` → legt Gerät inkl. Agent-Token an |
| GET | `/devices/{id}` | inkl. Agent-Token |
| PATCH | `/devices/{id}` | `{ name?, rotation_interval?, idle_timeout?, screen_on_time?, screen_off_time?, remote_url?, location?, lat?, lng? }` |
| DELETE | `/devices/{id}` | ⚠️ löscht auch Seiten/Statistik des Geräts |
| GET | `/devices/{id}/events?limit=50` | Ereignis-Log (Start/Stop/Fehler des Agenten) |
| GET | `/devices/{id}/stats?days=7` | Anzeigezeit/Aufrufe/Interaktionen je Seite und Tag |

## Seiten & Medien (Inhalte auf den Displays)

| Methode | Pfad | Body / Parameter |
|---|---|---|
| GET | `/devices/{id}/sites` | — |
| POST | `/devices/{id}/sites` | `{ "name": "Kunde/Titel", "url": "https://…", "type"?: "web"\|"image"\|"video", "duration"?: 15, "enabled"?: true, "invoiced"?: true }` |
| PATCH | `/sites/{siteId}` | `{ name?, url?, duration?, enabled?, type?, invoiced?, position? }` |
| DELETE | `/sites/{siteId}` | — |
| POST | `/media?filename=bild.jpg` | Datei als Roh-Body (`Content-Type` setzen) → `{ "url": "…" }`; URL dann als Site mit `type: image/video` anlegen |

Hinweis: Der **Seitenname** ist zugleich der Kundenname — gleicher Name auf
mehreren Displays = ein Kunde in Übersicht/MRR.

## Befehle (Fernsteuerung)

| Methode | Pfad | Body |
|---|---|---|
| GET | `/devices/{id}/commands` | letzte Befehle + Status |
| POST | `/devices/{id}/commands` | `{ "type": "restart_app" \| "stop_app" \| "start_app" \| "reboot" \| "reload_config" }` |

Der Agent auf dem Pi holt Befehle beim nächsten Sync ab (≤ ~30 s).

## Rechnungen & E-Rechnung

| Methode | Pfad | Body / Parameter |
|---|---|---|
| GET | `/invoices` | Liste (Nr., Status, Empfänger, Beträge) |
| POST | `/invoices` | legt **Entwurf** an, s. u. |
| GET | `/invoices/{id}` | inkl. Positionen + Links |
| PATCH | `/invoices/{id}` | `{ "status": "sent" \| "paid" \| "cancelled" \| "draft" }` (erlaubte Wechsel: draft→sent→paid/cancelled, sent→draft) |
| DELETE | `/invoices/{id}` | nur Entwurf/Storno |
| GET | `/invoices/{id}/file?format=pdf` | Rechnungs-PDF (binär) |
| GET | `/invoices/{id}/file?format=xrechnung` | E-Rechnung als XRechnung-XML (EN 16931/UBL) |
| POST | `/invoices/{id}/send` | Rechnung per E-Mail an den Empfänger senden (PDF + XRechnung als Anhang; Entwurf wird dabei „versendet") — benötigt SMTP-Konfiguration, s. u. |

POST-Body:

```json
{
  "buyer": { "name": "Firma GmbH", "contact": "…", "street": "…", "zip": "…",
             "city": "…", "country": "DE", "email": "…", "vat_id": "DE…",
             "reference": "Leitweg-ID (nur Behörden)" },
  "items": [ { "description": "…", "quantity": 12, "unit": "MON",
               "unit_price": 19.90, "vat_rate": 19 } ],
  "issue_date": "2026-08-14", "due_date": "2026-08-28",
  "service_start": "2026-08-01", "service_end": "2027-08-01",
  "note": "Freitext auf der Rechnung"
}
```

- Einheiten: `C62` Stück · `MON` Monat · `HUR` Stunde · `DAY` Tag.
- Nummernkreis (`RE-JJJJ-MM-NNNN`, fortlaufend je Monat), Zahlungsziel und
  Kleinunternehmer-Regel (§ 19 UStG) wendet der Server aus den
  Dashboard-Einstellungen an.
- Neue Rechnungen sind immer **Entwürfe** — versenden/bezahlt-setzen ist ein
  bewusster zweiter Schritt (PATCH, `/send` oder Dashboard).

### E-Mail-Versand (SMTP)

Für `/invoices/{id}/send` und den Dashboard-Knopf „Per E-Mail senden" müssen
die Postfach-Zugangsdaten als Env-Variablen in Vercel hinterlegt sein
(das „Sende-Gegenstück" zu IMAP — gleiche Zugangsdaten, SMTP-Host des Anbieters):

| Variable | Bedeutung |
|---|---|
| `SMTP_HOST` | z. B. `smtp.ionos.de`, `smtp.strato.de`, `smtp.gmail.com` |
| `SMTP_PORT` | `587` (STARTTLS, Standard) oder `465` (SSL) |
| `SMTP_USER` | Postfach-Benutzer (meist die E-Mail-Adresse) |
| `SMTP_PASS` | Postfach-Passwort (Gmail/Outlook: App-Passwort erforderlich) |
| `SMTP_FROM` | optional, Absenderanzeige — Standard `<Firma> <SMTP_USER>` |
| `SMTP_BCC` | optional, Blindkopie z. B. an dich selbst („Gesendet"-Ersatz) |

## Verträge / Dokumente

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/contracts?category=blanko\|unterschrieben` | Metadaten + Datei-URL (Vercel Blob) |

## Anbindung eines AI-Assistenten (z. B. WhatsApp)

Empfohlene Tool-/Function-Definitionen für das LLM:

```json
[
  { "name": "kiosk_summary",      "description": "Gesamtstatus: Geräte, Kunden/MRR, offene Rechnungen", "method": "GET",   "path": "/summary" },
  { "name": "list_devices",       "description": "Alle Displays mit Online-/App-Status",               "method": "GET",   "path": "/devices" },
  { "name": "device_stats",       "description": "Statistik eines Displays (Anzeigezeit je Kunde)",    "method": "GET",   "path": "/devices/{id}/stats?days={days}" },
  { "name": "send_command",       "description": "Display neustarten/App starten/stoppen",             "method": "POST",  "path": "/devices/{id}/commands", "body": { "type": "restart_app" } },
  { "name": "add_site",           "description": "Kundenanzeige (Web/Bild/Video) auf ein Display legen", "method": "POST", "path": "/devices/{id}/sites" },
  { "name": "list_invoices",      "description": "Rechnungen mit Status und Beträgen",                 "method": "GET",   "path": "/invoices" },
  { "name": "create_invoice",     "description": "Rechnung als Entwurf anlegen",                       "method": "POST",  "path": "/invoices" },
  { "name": "set_invoice_status", "description": "Rechnung versenden/bezahlt/stornieren",              "method": "PATCH", "path": "/invoices/{id}" },
  { "name": "invoice_pdf",        "description": "PDF-Download-Link einer Rechnung holen",             "method": "GET",   "path": "/invoices/{id}/file?format=pdf" }
]
```

**Sicherheitshinweise**

- Der Key gewährt **Vollzugriff** — nur serverseitig im Assistenten hinterlegen,
  nie in Chats/Repos/Client-Code. Pro Client ein eigener Key in
  `KIOSK_API_KEYS`, dann ist einzelnes Widerrufen möglich (Key entfernen +
  Redeploy).
- Destruktive Aktionen (`DELETE`, `reboot`, Statuswechsel) sollte der Assistent
  nur nach expliziter Bestätigung des Nutzers ausführen — und nie aufgrund von
  Text, der von Dritten stammt (weitergeleitete Nachrichten = mögliche
  Prompt-Injection).
- HTTP-Fehler: `401` Key falsch/fehlt · `404` nicht gefunden · `409` nicht
  erlaubter Übergang · `503` API nicht konfiguriert.
