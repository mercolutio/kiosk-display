import { sql } from '@/lib/db';
import { requireApi, ok } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/v1/devices/{id}/stats?days=7 — Wiedergabe-/Interaktions-Statistik je Seite
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  const daysParam = parseInt(new URL(request.url).searchParams.get('days') || '7', 10) || 7;
  const days = Math.min(90, Math.max(1, daysParam));

  let rows: any[] = [];
  try {
    const r = await sql`
      select url, sum(seconds)::int as seconds, sum(views)::int as views,
             sum(pauses)::int as pauses, sum(pause_seconds)::int as pause_seconds
        from site_stats
       where device_id = ${id} and day >= current_date - ${days - 1}::int
       group by url order by seconds desc`;
    rows = r.rows;
  } catch {
    try {
      const r = await sql`
        select url, sum(seconds)::int as seconds, sum(views)::int as views
          from site_stats
         where device_id = ${id} and day >= current_date - ${days - 1}::int
         group by url order by seconds desc`;
      rows = r.rows;
    } catch { /* site_stats evtl. noch nicht angelegt */ }
  }

  const names: Record<string, string> = {};
  try {
    const s = await sql`select url, name from sites where device_id = ${id}`;
    for (const x of s.rows) names[x.url] = x.name;
  } catch { /* ignore */ }

  const total = rows.reduce((a, r) => a + (r.seconds || 0), 0);
  return ok({
    days,
    total_seconds: total,
    sites: rows.map((r) => ({
      url: r.url,
      name: names[r.url] || null,
      seconds: r.seconds || 0,
      views: r.views || 0,
      pauses: r.pauses || 0,
      pause_seconds: r.pause_seconds || 0,
    })),
  });
}
