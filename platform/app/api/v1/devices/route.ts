import { sql, ensureSchema } from '@/lib/db';
import { geocodeAddress } from '@/lib/geo';
import { requireApi, ok, err, readJson, serializeDevice } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/v1/devices — alle Geräte
export async function GET(request: Request) {
  const denied = requireApi(request);
  if (denied) return denied;
  await ensureSchema();
  try {
    const { rows } = await sql`select * from devices order by created_at asc`;
    return ok({ devices: rows.map((d) => serializeDevice(d)) });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}

// POST /api/v1/devices — Gerät anlegen { name, location? }
export async function POST(request: Request) {
  const denied = requireApi(request);
  if (denied) return denied;
  await ensureSchema();
  const body = await readJson(request);
  const name = String(body?.name || '').trim();
  if (!name) return err('Feld "name" erforderlich', 400);
  const location = body?.location ? String(body.location).trim() : null;
  const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
  let row: any;
  try {
    const r = await sql`insert into devices (name, token) values (${name}, ${token}) returning *`;
    row = r.rows[0];
  } catch (e) {
    return err((e as Error).message, 500);
  }
  if (location) {
    try { await sql`update devices set location = ${location} where id = ${row.id}`; row.location = location; } catch {}
    const c = await geocodeAddress(location);
    if (c) {
      try { await sql`update devices set lat = ${c.lat}, lng = ${c.lng} where id = ${row.id}`; row.lat = c.lat; row.lng = c.lng; } catch {}
    }
  }
  return ok({ device: serializeDevice(row, true) }, 201);
}
