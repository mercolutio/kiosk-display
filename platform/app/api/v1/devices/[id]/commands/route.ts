import { sql, ensureSchema } from '@/lib/db';
import { requireApi, ok, err, readJson, COMMAND_TYPES } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/v1/devices/{id}/commands — letzte Befehle
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  const { rows } = await sql`
    select id, type, status, result, created_at, executed_at
      from commands where device_id = ${id} order by created_at desc limit 20
  `;
  return ok({ commands: rows });
}

// POST /api/v1/devices/{id}/commands — { type } in Warteschlange legen
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  await ensureSchema();
  const dev = await sql`select id from devices where id = ${id} limit 1`;
  if (!dev.rows[0]) return err('Gerät nicht gefunden', 404);
  const body = await readJson(request);
  const type = String(body?.type || '').trim();
  if (!COMMAND_TYPES.includes(type)) {
    return err('Feld "type" muss eines sein von: ' + COMMAND_TYPES.join(', '), 400);
  }
  try {
    const ins = await sql`insert into commands (device_id, type) values (${id}, ${type}) returning id, type, status, created_at`;
    return ok({ command: ins.rows[0] }, 201);
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
