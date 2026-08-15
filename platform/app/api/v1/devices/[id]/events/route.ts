// REST-API: Ereignis-Log eines Geräts (vom Agenten gemeldet).
//   GET /api/v1/devices/{id}/events?limit=50
import { sql, ensureSchema } from '@/lib/db';
import { requireApi, ok, err } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  await ensureSchema();
  const limit = Math.min(500, Math.max(1, parseInt(new URL(request.url).searchParams.get('limit') || '50', 10) || 50));
  try {
    const { rows } = await sql`
      select level, message, created_at from events
       where device_id = ${id}
       order by created_at desc
       limit ${limit}
    `;
    return ok({ events: rows });
  } catch (e) {
    return err('DB-Fehler: ' + (e as Error).message, 500);
  }
}
