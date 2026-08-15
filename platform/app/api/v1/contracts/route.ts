// REST-API: Verträge/Dokumente auflisten (Metadaten + Datei-URL).
//   GET /api/v1/contracts            -> alle
//   GET /api/v1/contracts?category=unterschrieben|blanko
import { sql, ensureSchema } from '@/lib/db';
import { requireApi, ok, err } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireApi(request);
  if (denied) return denied;
  await ensureSchema();
  const cat = new URL(request.url).searchParams.get('category') || '';
  try {
    const { rows } = await sql`
      select c.id, c.name, c.url, c.content_type, c.size, c.note, c.category,
             c.created_at, d.name as device_name
        from contracts c
        left join devices d on d.id = c.device_id
       order by c.created_at desc
    `;
    const contracts = rows.filter((r: any) => !cat || (r.category || 'blanko') === cat);
    return ok({ contracts });
  } catch (e) {
    return err('DB-Fehler: ' + (e as Error).message, 500);
  }
}
