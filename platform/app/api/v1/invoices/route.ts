// REST-API: Rechnungen auflisten und anlegen.
//   GET  /api/v1/invoices           -> Liste (neueste zuerst)
//   POST /api/v1/invoices           -> legt eine Rechnung als ENTWURF an
// Auth wie die uebrige v1-API: Bearer KIOSK_API_KEY.
//
// POST-Body:
// {
//   "buyer": { "name": "...", "contact"?, "street"?, "zip"?, "city"?, "country"?,
//              "email"?, "vat_id"?, "reference"? },
//   "items": [{ "description": "...", "quantity": 1, "unit"?: "C62|MON|HUR|DAY",
//               "unit_price": 19.9, "vat_rate"?: 19|7|0 }],
//   "issue_date"?, "due_date"?, "service_start"?, "service_end"?  (YYYY-MM-DD),
//   "note"?: "..."
// }
// Kleinunternehmer-Einstellung (§ 19 UStG) wird serverseitig angewendet.
import { sql, ensureSchema } from '@/lib/db';
import { requireApi, ok, err, readJson } from '@/lib/api';
import {
  computeTotals, getCompany, nextInvoiceNumber, normalizeInvoiceRow,
  type InvoiceItem,
} from '@/lib/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const unauthorized = requireApi(request);
  if (unauthorized) return unauthorized;
  await ensureSchema();
  try {
    const { rows } = await sql`select * from invoices order by number desc limit 200`;
    return ok({
      invoices: rows.map(normalizeInvoiceRow).map((r) => ({
        id: r.id, number: r.number, status: r.status,
        issue_date: r.issue_date, due_date: r.due_date,
        buyer: r.c_name,
        net_total: r.net_total, tax_total: r.tax_total, gross_total: r.gross_total,
      })),
    });
  } catch (e) {
    return err('DB-Fehler: ' + (e as Error).message, 500);
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const s = (v: unknown) => String(v ?? '').trim();
const d = (v: unknown) => (DATE.test(s(v)) ? s(v) : null);

export async function POST(request: Request) {
  const unauthorized = requireApi(request);
  if (unauthorized) return unauthorized;
  await ensureSchema();
  const body = await readJson(request);

  const buyer = body?.buyer || {};
  if (!s(buyer.name)) return err('buyer.name fehlt');

  const company = await getCompany();
  const items: InvoiceItem[] = [];
  for (const r of Array.isArray(body?.items) ? body.items : []) {
    const description = s(r?.description);
    if (!description) continue;
    const quantity = Math.max(0, Number(r?.quantity) || 0);
    const unit = ['C62', 'MON', 'HUR', 'DAY'].includes(s(r?.unit)) ? s(r.unit) : 'C62';
    const unit_price = Math.round((Number(r?.unit_price) || 0) * 100) / 100;
    let vat_rate = [19, 7, 0].includes(Number(r?.vat_rate)) ? Number(r.vat_rate) : 19;
    if (company.small_business) vat_rate = 0; // § 19 UStG
    items.push({ position: items.length, description, quantity, unit, unit_price, vat_rate });
  }
  if (items.length === 0) return err('items fehlen (mind. eine Position mit description)');

  const t = computeTotals(items);
  const issue = d(body?.issue_date) || new Date().toISOString().slice(0, 10);
  const due = d(body?.due_date)
    || new Date(new Date(issue).getTime() + company.payment_days * 86400_000).toISOString().slice(0, 10);

  let created: any = null;
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const number = await nextInvoiceNumber(company.invoice_prefix);
    try {
      const { rows } = await sql`
        insert into invoices (number, issue_date, due_date, service_start, service_end,
                              c_name, c_contact, c_street, c_zip, c_city, c_country,
                              c_email, c_vat_id, c_reference, note, small_business,
                              net_total, tax_total, gross_total)
        values (${number}, ${issue}, ${due}, ${d(body?.service_start)}, ${d(body?.service_end)},
                ${s(buyer.name)}, ${s(buyer.contact) || null}, ${s(buyer.street) || null},
                ${s(buyer.zip) || null}, ${s(buyer.city) || null},
                ${(s(buyer.country) || 'DE').toUpperCase().slice(0, 2)},
                ${s(buyer.email) || null}, ${s(buyer.vat_id) || null}, ${s(buyer.reference) || null},
                ${s(body?.note) || null}, ${company.small_business},
                ${t.net}, ${company.small_business ? 0 : t.tax}, ${company.small_business ? t.net : t.gross})
        returning *
      `;
      created = rows[0];
    } catch (e) {
      if (!/unique|duplicate/i.test((e as Error).message) || attempt === 2) {
        return err('DB-Fehler: ' + (e as Error).message, 500);
      }
    }
  }
  for (const it of items) {
    await sql`
      insert into invoice_items (invoice_id, position, description, quantity, unit, unit_price, vat_rate)
      values (${created.id}, ${it.position}, ${it.description}, ${it.quantity}, ${it.unit}, ${it.unit_price}, ${it.vat_rate})
    `;
  }

  const inv = normalizeInvoiceRow(created);
  const base = new URL(request.url).origin;
  return ok({
    invoice: {
      id: inv.id, number: inv.number, status: inv.status,
      issue_date: inv.issue_date, due_date: inv.due_date,
      service_start: inv.service_start, service_end: inv.service_end,
      buyer: inv.c_name,
      net_total: inv.net_total, tax_total: inv.tax_total, gross_total: inv.gross_total,
    },
    links: {
      dashboard: `${base}/rechnungen/${inv.id}`,
      pdf: `${base}/api/invoice-file?id=${inv.id}&format=pdf`,
      xrechnung: `${base}/api/invoice-file?id=${inv.id}&format=xrechnung`,
    },
  }, 201);
}
