-- Schema der Kiosk-Verwaltungsplattform.
-- Einmalig gegen die (Vercel-)Postgres-Datenbank ausfuehren.

create extension if not exists pgcrypto;

-- Ein Kiosk-Geraet (Raspberry Pi).
create table if not exists devices (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  token            text not null unique,          -- Geheim-Token, mit dem sich der Agent meldet
  rotation_interval int  not null default 15,     -- Fallback-Anzeigedauer (Sekunden)
  idle_timeout     int  not null default 5,
  screen_on_time   time,                           -- optionale Zeitsteuerung: an ab ...
  screen_off_time  time,                           -- ... aus ab ...
  last_seen_at     timestamptz,                    -- letzter Heartbeat (online/offline)
  current_site     text,                           -- vom Agent gemeldete aktuelle Seite
  agent_version    text,
  remote_url       text,                           -- Live-Fernsteuerung (VNC/noVNC im Browser)
  offline_alerted_at timestamptz,                   -- gesetzt, solange ein Offline-Alarm fuer dieses Geraet aktiv ist
  app_active       boolean,                          -- laeuft die Kiosk-App? (vom Agent gemeldet; nur bei online aktuell)
  location         text,                             -- optionale Standort-Bezeichnung (Adresse/Ladenname, fuers Popup)
  lat              double precision,                  -- Standort-Koordinaten, per Klick auf der Karte gesetzt
  lng              double precision,
  pending_stats    jsonb not null default '{}'::jsonb, -- gesammelte Statistik zwischen den Flushes (Anzeigezeit/Interaktionen)
  stats_flushed_at timestamptz,                       -- letzter Schreibvorgang in site_stats (Flush ~alle 6h)
  created_at       timestamptz not null default now()
);

-- Geordnete Liste der Webseiten je Geraet.
create table if not exists sites (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references devices(id) on delete cascade,
  name        text not null,
  url         text not null,                        -- Web-URL ODER Medien-URL (Bild/Video, in Vercel Blob)
  type        text not null default 'web' check (type in ('web', 'image', 'video')),
  duration    int,                                 -- optionale Anzeigedauer; NULL => rotation_interval
  position    int  not null default 0,             -- Reihenfolge
  enabled     boolean not null default true,
  invoiced    boolean not null default true,        -- fakturiert? nicht fakturiert => zaehlt nicht ins MRR
  created_at  timestamptz not null default now()
);
create index if not exists sites_device_pos on sites (device_id, position);

-- Befehlswarteschlange je Geraet (vom Agent abgeholt und quittiert).
create table if not exists commands (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references devices(id) on delete cascade,
  type        text not null check (type in ('restart_app', 'stop_app', 'start_app', 'reboot', 'reload_config')),
  status      text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  result      text,
  created_at  timestamptz not null default now(),
  executed_at timestamptz
);
create index if not exists commands_device_status on commands (device_id, status);

-- Aktivitaets-/Ereignis-Log je Geraet (vom Agent gemeldet, fuers Dashboard).
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references devices(id) on delete cascade,
  level       text not null default 'info',          -- info | warn | error
  message     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists events_device_time on events (device_id, created_at desc);

-- Wiedergabe-Statistik je Geraet+Seite+Tag (vom Sync-Endpoint per Sampling
-- aufsummiert): Anzeigezeit (Sekunden) und Anzahl Aufrufe (Wechsel auf die Seite).
create table if not exists site_stats (
  device_id  uuid not null references devices(id) on delete cascade,
  url        text not null,
  day        date not null default current_date,
  seconds    int  not null default 0,           -- aufsummierte Anzeigezeit
  views      int  not null default 0,            -- Anzahl Wechsel auf diese Seite
  pauses        int not null default 0,          -- Anzahl Interaktionen (Timer-Stopps durch Bedienung)
  pause_seconds int not null default 0,          -- Gesamtdauer dieser Interaktionen
  primary key (device_id, url, day)
);
create index if not exists site_stats_device_day on site_stats (device_id, day);

-- Hochgeladene Vertraege/Dokumente (z. B. Standortpartner-Vertraege), optional
-- einem Geraet zugeordnet. Datei liegt in Vercel Blob, hier nur die URL + Metadaten.
create table if not exists contracts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  url           text not null,                        -- Blob-URL der Datei
  content_type  text,
  size          int,
  note          text,
  category      text not null default 'blanko',        -- 'blanko' | 'unterschrieben'
  device_id     uuid references devices(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists contracts_created on contracts (created_at desc);

-- Rechnungsmodul: eigene Firmendaten (genau eine Zeile, id = 1).
create table if not exists company_settings (
  id             int primary key default 1 check (id = 1),
  name           text,
  owner          text,
  street         text,
  zip            text,
  city           text,
  country        text not null default 'DE',
  email          text,
  phone          text,
  website        text,
  tax_number     text,                              -- Steuernummer
  vat_id         text,                              -- USt-IdNr.
  iban           text,
  bic            text,
  bank_name      text,
  small_business boolean not null default false,    -- § 19 UStG (keine USt)
  payment_days   int not null default 14,
  invoice_prefix text not null default 'RE',
  invoice_footer text,
  smtp_host      text,                              -- E-Mail-Versand (SMTP) direkt aus dem Tool
  smtp_port      int,
  smtp_user      text,
  smtp_pass      text,
  smtp_from      text,
  smtp_bcc       text,
  updated_at     timestamptz not null default now()
);

-- Rechnungen: Empfaengerdaten als Schnappschuss (Rechnungsinhalt bleibt stabil,
-- auch wenn sich Stammdaten spaeter aendern). Betraege werden beim Speichern
-- aus den Positionen berechnet.
create table if not exists invoices (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  status         text not null default 'draft' check (status in ('draft','sent','paid','cancelled')),
  issue_date     date not null default current_date,
  due_date       date,
  service_start  date,                               -- Leistungszeitraum
  service_end    date,
  c_name         text not null,
  c_contact      text,
  c_street       text,
  c_zip          text,
  c_city         text,
  c_country      text not null default 'DE',
  c_email        text,
  c_vat_id       text,
  c_reference    text,                               -- Kaeufer-Referenz / Leitweg-ID (BT-10)
  note           text,
  small_business boolean not null default false,
  net_total      numeric(12,2) not null default 0,
  tax_total      numeric(12,2) not null default 0,
  gross_total    numeric(12,2) not null default 0,
  paid_at        date,
  created_at     timestamptz not null default now()
);

create table if not exists invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  position    int not null default 0,
  description text not null,
  quantity    numeric(12,2) not null default 1,
  unit        text not null default 'C62',           -- UN/ECE-Einheit: C62 Stk, MON Monat, HUR Std, DAY Tag
  unit_price  numeric(12,2) not null default 0,
  vat_rate    numeric(5,2) not null default 19
);
create index if not exists invoice_items_invoice on invoice_items (invoice_id, position);
