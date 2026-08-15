// REST-API: einzelne Rechnung lesen, Status ändern, Entwurf löschen.
//   GET    /api/v1/invoices/{id}            -> Rechnung inkl. Positionen
//   PATCH  /api/v1/invoices/{id}            -> { status: sent|paid|cancelled|draft }
//   DELETE /api/v1/invoices/{id}            -> nur Entwurf/Storno (GoBD)
import { sql, ensureSchema } from '@/lib/db';
import { requireApi, ok, err, readJson } from '@/lib/api';
import { loadInvoice } from '@/lib/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(invoice: any, items: any[]) {
  return {
    ...invoice,
    items: items.map((it) => ({
      position: it.position, description: it.description, quantity: it.quantity,
      unit: it.unit, unit_price: it.unit_price, vat_rate: it.vat_rate,
    })),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  const data = await loadInvoice(id);
  if (!data) return err('Rechnung nicht gefunden', 404);
  const base = new URL(request.url).origin;
  return ok({
    invoice: serialize(data.invoice, data.items),
    links: {
      dashboard: `${base}/rechnungen/${id}`,
      pdf: `${base}/api/v1/invoices/${id}/file?format=pdf`,
      xrechnung: `${base}/api/v1/invoices/${id}/file?format=xrechnung`,
    },
  });
}

// Erlaubte Statuswechsel (wie im Dashboard): Entwurf -> Offen -> Bezahlt/Storno,
// Offen -> Entwurf (zurückholen). Bezahlte Rechnungen bleiben bezahlt.
const TRANSITIONS: Record<string, string[]> = {
  sent: ['draft'],
  paid: ['sent'],
  cancelled: ['draft', 'sent'],
  draft: ['sent'],
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  await ensureSchema();
  const body = await readJson(request);
  const to = String(body?.status || '').trim();
  const from = TRANSITIONS[to];
  if (!from) return err('status muss sein: sent | paid | cancelled | draft');
  const { rows } = await sql`select status from invoices where id = ${id} limit 1`;
  if (!rows[0]) return err('Rechnung nicht gefunden', 404);
  if (!from.includes(rows[0].status)) {
    return err(`Statuswechsel ${rows[0].status} -> ${to} nicht erlaubt`, 409);
  }
  if (to === 'paid') {
    await sql`update invoices set status = 'paid', paid_at = current_date where id = ${id}`;
  } else {
    await sql`update invoices set status = ${to}, paid_at = null where id = ${id}`;
  }
  const data = await loadInvoice(id);
  return ok({ invoice: data ? serialize(data.invoice, data.items) : null });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  await ensureSchema();
  const { rowCount } = await sql`
    delete from invoices where id = ${id} and status in ('draft', 'cancelled')
  `;
  if (!rowCount) return err('nicht gefunden oder nicht löschbar (nur Entwurf/Storno)', 409);
  return ok({ deleted: true, id });
}
