// Lebensader Pi <-> Cloud: Der Agent pollt diesen Endpoint (Pull-Prinzip,
// funktioniert hinter NAT/Firewall). Authentifizierung per Geraete-Token.
//
// Request  (POST, Header: Authorization: Bearer <token>):
//   { agent_version, current_site, ack: [{ id, status, result }] }
// Response:
//   { device, config: { rotationInterval, idleTimeout, screenOnTime,
//                        screenOffTime, sites: [{url,name,duration?}] },
//     commands: [{ id, type }] }
import { sql, ensureSchema } from '@/lib/db';
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
  try { await ensureSchema(); } catch { /* DB evtl. nicht erreichbar */ }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* leerer Body ist erlaubt */
  }

  // Heartbeat aktualisieren.
  const currentSite = typeof body.current_site === 'string' ? body.current_site : null;
  const agentVersion = typeof body.agent_version === 'string' ? body.agent_version : null;
  const appActive = typeof body.app_active === 'boolean' ? body.app_active : null;
  await sql`
    update devices
       set last_seen_at = now(), current_site = ${currentSite}, agent_version = ${agentVersion}
     where id = ${device.id}
  `;
  // App-Status separat -> bricht den Heartbeat nicht, falls die Spalte noch fehlt.
  try { await sql`update devices set app_active = ${appActive} where id = ${device.id}`; } catch {}

  // Offline-Alarm: dieses Geraet ist gerade online -> falls es zuvor als offline
  // gemeldet war, "wieder online" senden; danach die Flotte auf neu offline
  // gegangene Geraete pruefen (beide Schritte fehlertolerant).
  await handleRecovery(device.id);
  await checkOfflineAndAlert();

  // Wiedergabe-/Interaktions-Statistik: NICHT mehr bei jedem Sync schreiben,
  // sondern in devices.pending_stats sammeln und nur ~alle 6 Std. (4x/Tag) in
  // die site_stats-Tabelle schreiben. (device.* sind hier noch die VORHERIGEN
  // Werte von vor dem Heartbeat-Update oben.)
  const STATS_FLUSH_MS = 6 * 60 * 60 * 1000;
  const pending: Record<string, any> =
    device.pending_stats && typeof device.pending_stats === 'object' ? { ...device.pending_stats } : {};
  const bump = (url: string, field: string, amount: number) => {
    if (!amount) return;
    if (!pending[url]) pending[url] = { seconds: 0, views: 0, pauses: 0, pause_seconds: 0 };
    pending[url][field] = (pending[url][field] || 0) + amount;
  };

  // Anzeigezeit seit dem letzten Heartbeat der aktuellen Seite gutschreiben
  // (Sampling). Lange Luecken (offline) werden ignoriert.
  if (currentSite) {
    const prevSeenMs = device.last_seen_at ? new Date(device.last_seen_at).getTime() : 0;
    const elapsedSec = prevSeenMs ? Math.round((Date.now() - prevSeenMs) / 1000) : 0;
    if (elapsedSec > 0 && elapsedSec <= 60) {
      bump(currentSite, 'seconds', elapsedSec);
      if (currentSite !== device.current_site) bump(currentSite, 'views', 1);
    }
  }
  // Interaktions-Deltas (Timer-Stopps durch Bedienung) dazurechnen.
  if (Array.isArray(body.interactions)) {
    for (const it of body.interactions) {
      if (!it || typeof it.url !== 'string') continue;
      bump(it.url, 'pauses', Number.isFinite(it.count) ? Math.max(0, Math.round(it.count)) : 0);
      bump(it.url, 'pause_seconds', Number.isFinite(it.ms) ? Math.max(0, Math.round(it.ms / 1000)) : 0);
    }
  }

  // Flush faellig? (erst wenn der 6h-Timer laeuft UND abgelaufen ist)
  const lastFlush = device.stats_flushed_at ? new Date(device.stats_flushed_at).getTime() : null;
  const flushDue = lastFlush !== null && Date.now() - lastFlush >= STATS_FLUSH_MS;

  let flushed = false;
  if (flushDue && Object.keys(pending).length > 0) {
    try {
      for (const [url, s] of Object.entries(pending)) {
        const sec = s.seconds || 0, views = s.views || 0, pauses = s.pauses || 0, ps = s.pause_seconds || 0;
        if (!sec && !views && !pauses && !ps) continue;
        // Nur konfigurierte Seiten zaehlen -> Fremd-/Startseiten verfaelschen die Statistik nicht.
        await sql`
          insert into site_stats (device_id, url, day, seconds, views, pauses, pause_seconds)
          select ${device.id}, ${url}, current_date, ${sec}, ${views}, ${pauses}, ${ps}
           where exists (select 1 from sites where device_id = ${device.id} and url = ${url})
          on conflict (device_id, url, day) do update
            set seconds = site_stats.seconds + ${sec},
                views = site_stats.views + ${views},
                pauses = site_stats.pauses + ${pauses},
                pause_seconds = site_stats.pause_seconds + ${ps}`;
      }
      flushed = true;
    } catch {
      flushed = false; // beim naechsten Mal erneut versuchen (pending bleibt erhalten)
    }
  }

  // pending_stats / Flush-Zeitpunkt speichern (fehlertolerant -> bricht den Sync nie).
  try {
    if (flushed) {
      await sql`update devices set pending_stats = '{}'::jsonb, stats_flushed_at = now() where id = ${device.id}`;
    } else if (lastFlush === null) {
      await sql`update devices set pending_stats = ${JSON.stringify(pending)}::jsonb, stats_flushed_at = now() where id = ${device.id}`;
    } else {
      await sql`update devices set pending_stats = ${JSON.stringify(pending)}::jsonb where id = ${device.id}`;
    }
  } catch {
    /* Spalten pending_stats/stats_flushed_at evtl. noch nicht migriert -> ignorieren */
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
