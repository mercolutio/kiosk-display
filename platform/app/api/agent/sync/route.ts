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

  // Aktuelle Seiten-Config zusammenstellen (nur aktivierte, in Reihenfolge).
  const { rows: siteRows } = await sql`
    select name, url, duration from sites
     where device_id = ${device.id} and enabled = true
     order by position asc, created_at asc
  `;
  const sites = siteRows.map((s: any) => {
    const entry: any = { url: s.url, name: s.name };
    if (s.duration != null) entry.duration = s.duration;
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
