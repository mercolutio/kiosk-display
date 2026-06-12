// Lebensader Pi <-> Cloud: Der Agent pollt diesen Endpoint (Pull-Prinzip,
// funktioniert hinter NAT/Firewall). Authentifizierung per Geraete-Token.
//
// Request  (POST, Header: Authorization: Bearer <token>):
//   { agent_version, current_site, ack: [{ id, status, result }] }
// Response:
//   { device, config: { rotationInterval, idleTimeout, screenOnTime,
//                        screenOffTime, sites: [{url,name,duration?}] },
//     commands: [{ id, type }] }
import { sql } from '@/lib/db';
import { handleRecovery, checkOfflineAndAlert } from '@/lib/alerts';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'missing token' }, { status: 401 });
  }

  const { rows: devices } = await sql`
    select * from devices where token = ${token} limit 1
  `;
  const device = devices[0];
  if (!device) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* leerer Body ist erlaubt */
  }

  // Heartbeat aktualisieren.
  const currentSite = typeof body.current_site === 'string' ? body.current_site : null;
  const agentVersion = typeof body.agent_version === 'string' ? body.agent_version : null;
  await sql`
    update devices
       set last_seen_at = now(), current_site = ${currentSite}, agent_version = ${agentVersion}
     where id = ${device.id}
  `;

  // Offline-Alarm: dieses Geraet ist gerade online -> falls es zuvor als offline
  // gemeldet war, "wieder online" senden; danach die Flotte auf neu offline
  // gegangene Geraete pruefen (beide Schritte fehlertolerant).
  await handleRecovery(device.id);
  await checkOfflineAndAlert();

  // Wiedergabe-Statistik: die seit dem letzten Heartbeat vergangene Zeit der
  // aktuell gemeldeten Seite gutschreiben (Sampling). Lange Luecken (offline)
  // werden ignoriert, damit nur echte Anzeigezeit zaehlt. (device.* sind hier
  // noch die VORHERIGEN Werte vor dem Update oben.)
  if (currentSite) {
    const prevSeenMs = device.last_seen_at ? new Date(device.last_seen_at).getTime() : 0;
    const elapsedSec = prevSeenMs ? Math.round((Date.now() - prevSeenMs) / 1000) : 0;
    if (elapsedSec > 0 && elapsedSec <= 60) {
      const isNewView = currentSite !== device.current_site ? 1 : 0;
      try {
        // Nur konfigurierte Seiten zaehlen -> Start-/Default-Seiten oder manuell
        // angesteuerte Fremdseiten verfaelschen die Statistik nicht.
        await sql`
          insert into site_stats (device_id, url, day, seconds, views)
          select ${device.id}, ${currentSite}, current_date, ${elapsedSec}, ${isNewView}
           where exists (select 1 from sites where device_id = ${device.id} and url = ${currentSite})
          on conflict (device_id, url, day) do update
            set seconds = site_stats.seconds + ${elapsedSec},
                views   = site_stats.views   + ${isNewView}
        `;
      } catch {
        /* site_stats-Tabelle evtl. noch nicht migriert -> ignorieren */
      }
    }
  }

  // Interaktions-Statistik (Timer-Stopps durch Bedienung): Deltas vom Agent den
  // konfigurierten Seiten gutschreiben (Haeufigkeit + Gesamtdauer).
  if (Array.isArray(body.interactions)) {
    for (const it of body.interactions) {
      if (!it || typeof it.url !== 'string') continue;
      const count = Number.isFinite(it.count) ? Math.max(0, Math.round(it.count)) : 0;
      const pauseSec = Number.isFinite(it.ms) ? Math.max(0, Math.round(it.ms / 1000)) : 0;
      if (count === 0 && pauseSec === 0) continue;
      try {
        await sql`
          insert into site_stats (device_id, url, day, pauses, pause_seconds)
          select ${device.id}, ${it.url}, current_date, ${count}, ${pauseSec}
           where exists (select 1 from sites where device_id = ${device.id} and url = ${it.url})
          on conflict (device_id, url, day) do update
            set pauses = site_stats.pauses + ${count},
                pause_seconds = site_stats.pause_seconds + ${pauseSec}
        `;
      } catch {
        /* Spalten pauses/pause_seconds evtl. noch nicht migriert -> ignorieren */
      }
    }
  }

  // Vom Agent ausgefuehrte Befehle quittieren.
  if (Array.isArray(body.ack)) {
    for (const a of body.ack) {
      if (a && typeof a.id === 'string') {
        const status = a.status === 'failed' ? 'failed' : 'done';
        const result = typeof a.result === 'string' ? a.result : null;
        await sql`
          update commands
             set status = ${status}, executed_at = now(), result = ${result}
           where id = ${a.id} and device_id = ${device.id}
        `;
      }
    }
  }

  // Aktivitaets-Log des Agents speichern (best effort; ohne events-Tabelle uebersprungen).
  if (Array.isArray(body.logs) && body.logs.length > 0) {
    try {
      for (const e of body.logs.slice(-50)) {
        if (e && typeof e.message === 'string') {
          const level = e.level === 'error' || e.level === 'warn' ? e.level : 'info';
          await sql`insert into events (device_id, level, message) values (${device.id}, ${level}, ${e.message})`;
        }
      }
      await sql`
        delete from events where device_id = ${device.id} and id not in (
          select id from events where device_id = ${device.id} order by created_at desc limit 200
        )
      `;
    } catch {
      /* events-Tabelle evtl. noch nicht angelegt -> ignorieren */
    }
  }

  // Aktuelle Seiten-Config zusammenstellen (nur aktivierte, in Reihenfolge).
  // type wird resilient gelesen (Fallback ohne Spalte, falls noch nicht migriert).
  let siteRows: any[] = [];
  try {
    const r = await sql`
      select name, url, duration, type from sites
       where device_id = ${device.id} and enabled = true
       order by position asc, created_at asc`;
    siteRows = r.rows;
  } catch {
    const r = await sql`
      select name, url, duration from sites
       where device_id = ${device.id} and enabled = true
       order by position asc, created_at asc`;
    siteRows = r.rows;
  }
  const sites = siteRows.map((s: any) => {
    const entry: any = { url: s.url, name: s.name };
    if (s.duration != null) entry.duration = s.duration;
    if (s.type && s.type !== 'web') entry.type = s.type;  // nur bei Bild/Video mitschicken
    return entry;
  });

  // Offene Befehle ausliefern.
  const { rows: commands } = await sql`
    select id, type from commands
     where device_id = ${device.id} and status = 'pending'
     order by created_at asc
  `;

  return NextResponse.json({
    device: { name: device.name },
    config: {
      rotationInterval: device.rotation_interval,
      idleTimeout: device.idle_timeout,
      screenOnTime: device.screen_on_time,
      screenOffTime: device.screen_off_time,
      sites,
    },
    commands,
  });
}
