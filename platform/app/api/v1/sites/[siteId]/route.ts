import { sql, ensureSchema } from '@/lib/db';
import { requireApi, ok, err, readJson, serializeSite, SITE_TYPES } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadSite(id: string) {
  const { rows } = await sql`select * from sites where id = ${id} limit 1`;
  return rows[0] || null;
}

// PATCH /api/v1/sites/{siteId}
export async function PATCH(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { siteId } = await params;
  await ensureSchema();
  const cur = await loadSite(siteId);
  if (!cur) return err('Seite nicht gefunden', 404);
  const body = await readJson(request);

  const name = body.name != null ? (String(body.name).trim() || cur.name) : cur.name;
  const url = body.url != null ? (String(body.url).trim() || cur.url) : cur.url;
  const duration = body.duration !== undefined
    ? (body.duration == null ? null : (parseInt(String(body.duration), 10) || null))
    : cur.duration;
  const enabled = body.enabled !== undefined ? !!body.enabled : cur.enabled;
  await sql`update sites set name = ${name}, url = ${url}, duration = ${duration}, enabled = ${enabled} where id = ${siteId}`;
  if (body.type !== undefined && SITE_TYPES.includes(body.type)) {
    try { await sql`update sites set type = ${body.type} where id = ${siteId}`; } catch {}
  }
  if (body.invoiced !== undefined) {
    try { await sql`update sites set invoiced = ${!!body.invoiced} where id = ${siteId}`; } catch {}
  }
  if (body.position !== undefined) {
    const p = parseInt(String(body.position), 10);
    if (Number.isFinite(p)) { try { await sql`update sites set position = ${p} where id = ${siteId}`; } catch {} }
  }
  const after = await loadSite(siteId);
  return ok({ site: serializeSite(after) });
}

// DELETE /api/v1/sites/{siteId}
export async function DELETE(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { siteId } = await params;
  const { rowCount } = await sql`delete from sites where id = ${siteId}`;
  if (!rowCount) return err('Seite nicht gefunden', 404);
  return ok({ deleted: true, id: siteId });
}
