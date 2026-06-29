import { sql, ensureSchema } from '@/lib/db';
import { requireApi, ok, err, readJson, serializeSite, SITE_TYPES } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/v1/devices/{id}/sites
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  await ensureSchema();
  const dev = await sql`select id from devices where id = ${id} limit 1`;
  if (!dev.rows[0]) return err('Gerät nicht gefunden', 404);
  const { rows } = await sql`select * from sites where device_id = ${id} order by position asc, created_at asc`;
  return ok({ sites: rows.map(serializeSite) });
}

// POST /api/v1/devices/{id}/sites — { name, url, type?, duration?, enabled?, invoiced? }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  await ensureSchema();
  const dev = await sql`select id from devices where id = ${id} limit 1`;
  if (!dev.rows[0]) return err('Gerät nicht gefunden', 404);
  const body = await readJson(request);
  const name = String(body?.name || '').trim();
  const url = String(body?.url || '').trim();
  if (!name || !url) return err('Felder "name" und "url" erforderlich', 400);
  const type = SITE_TYPES.includes(body?.type) ? body.type : 'web';
  const duration = body?.duration != null ? (parseInt(String(body.duration), 10) || null) : null;
  const enabled = body?.enabled === undefined ? true : !!body.enabled;
  const invoiced = body?.invoiced === undefined ? true : !!body.invoiced;
  const pos = await sql`select coalesce(max(position), -1) + 1 as pos from sites where device_id = ${id}`;
  const ins = await sql`
    insert into sites (device_id, name, url, duration, position, enabled)
    values (${id}, ${name}, ${url}, ${duration}, ${pos.rows[0].pos}, ${enabled})
    returning id
  `;
  const sid = ins.rows[0].id;
  try { await sql`update sites set type = ${type} where id = ${sid}`; } catch {}
  try { await sql`update sites set invoiced = ${invoiced} where id = ${sid}`; } catch {}
  const { rows } = await sql`select * from sites where id = ${sid} limit 1`;
  return ok({ site: serializeSite(rows[0]) }, 201);
}
