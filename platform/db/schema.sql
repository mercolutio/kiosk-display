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
