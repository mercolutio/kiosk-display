import { sql, ensureSchema } from '@/lib/db';
import { geocodeAddress } from '@/lib/geo';
import { requireApi, ok, err, readJson, serializeDevice } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function load(id: string) {
  const { rows } = await sql`select * from devices where id = ${id} limit 1`;
  return rows[0] || null;
}

// GET /api/v1/devices/{id}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  await ensureSchema();
  const d = await load(id);
  if (!d) return err('Gerät nicht gefunden', 404);
  return ok({ device: serializeDevice(d, true) });
}

// PATCH /api/v1/devices/{id}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  await ensureSchema();
  const cur = await load(id);
  if (!cur) return err('Gerät nicht gefunden', 404);
  const body = await readJson(request);

  const name = body.name != null ? (String(body.name).trim() || cur.name) : cur.name;
  const rotation = body.rotation_interval != null ? (parseInt(String(body.rotation_interval), 10) || cur.rotation_interval) : cur.rotation_interval;
  const idle = body.idle_timeout != null ? (parseInt(String(body.idle_timeout), 10) || cur.idle_timeout) : cur.idle_timeout;
  const onTime = body.screen_on_time !== undefined ? (String(body.screen_on_time || '').trim() || null) : cur.screen_on_time;
  const offTime = body.screen_off_time !== undefined ? (String(body.screen_off_time || '').trim() || null) : cur.screen_off_time;
  await sql`
    update devices set name = ${name}, rotation_interval = ${rotation}, idle_timeout = ${idle},
        screen_on_time = ${onTime}, screen_off_time = ${offTime}
     where id = ${id}
  `;
  if (body.remote_url !== undefined) {
    const r = body.remote_url ? String(body.remote_url).trim() : null;
    try { await sql`update devices set remote_url = ${r} where id = ${id}`; } catch {}
  }
  if (body.location !== undefined) {
    const loc = body.location ? String(body.location).trim() : null;
    try { await sql`update devices set location = ${loc} where id = ${id}`; } catch {}
    // Adresse neu? automatisch verorten (außer es kommen explizite Koordinaten mit).
    if (loc && loc !== cur.location && body.lat === undefined) {
      const c = await geocodeAddress(loc);
      if (c) { try { await sql`update devices set lat = ${c.lat}, lng = ${c.lng} where id = ${id}`; } catch {} }
    }
  }
  if (body.lat !== undefined && body.lng !== undefined) {
    const la = parseFloat(String(body.lat));
    const lo = parseFloat(String(body.lng));
    if (Number.isFinite(la) && Number.isFinite(lo)) {
      try { await sql`update devices set lat = ${la}, lng = ${lo} where id = ${id}`; } catch {}
    }
  }
  const after = await load(id);
  return ok({ device: serializeDevice(after, true) });
}

// DELETE /api/v1/devices/{id}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  const { rowCount } = await sql`delete from devices where id = ${id}`;
  if (!rowCount) return err('Gerät nicht gefunden', 404);
  return ok({ deleted: true, id });
}
