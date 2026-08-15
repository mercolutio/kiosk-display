// REST-API: Gesamtübersicht in einem Aufruf — gedacht für Chat-Assistenten
// ("Wie läuft's?"): Geräte-/App-Status, Kunden & MRR, offene Rechnungen.
//   GET /api/v1/summary
import { sql, ensureSchema } from '@/lib/db';
import { requireApi, ok, isOnline } from '@/lib/api';
import { normalizeInvoiceRow } from '@/lib/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Preispolitik wie im Dashboard: 19,90 €/Display, ab 3 Displays 14,90 €.
const PRICE_STD = 19.9;
const PRICE_VOL = 14.9;
const VOL_FROM = 3;

export async function GET(request: Request) {
  const denied = requireApi(request);
  if (denied) return denied;
  await ensureSchema();

  let devices: any[] = [];
  let sites: any[] = [];
  let invoices: any[] = [];
  try { devices = (await sql`select id, name, last_seen_at, app_active, current_site, location from devices order by created_at asc`).rows; } catch {}
  try { sites = (await sql`select device_id, name, invoiced from sites`).rows; } catch {}
  try { invoices = (await sql`select * from invoices`).rows.map(normalizeInvoiceRow); } catch {}

  const deviceList = devices.map((d) => ({
    id: d.id, name: d.name, location: d.location || null,
    online: isOnline(d.last_seen_at), app_active: d.app_active ?? null,
  }));

  // Kunden/MRR wie auf der Startseite: gleicher Seitenname = ein Kunde.
  const byKey = new Map<string, { name: string; placements: Map<string, boolean> }>();
  for (const s of sites) {
    const name = (s.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let c = byKey.get(key);
    if (!c) { c = { name, placements: new Map() }; byKey.set(key, c); }
    const billed = (c.placements.get(s.device_id) || false) || (s.invoiced !== false);
    c.placements.set(s.device_id, billed);
  }
  const customers = [...byKey.values()].map((c) => {
    const billed = [...c.placements.values()].filter(Boolean).length;
    const rate = billed >= VOL_FROM ? PRICE_VOL : PRICE_STD;
    return { name: c.name, displays: c.placements.size, billed, mrr: Math.round(billed * rate * 100) / 100 };
  }).sort((a, b) => b.mrr - a.mrr);

  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const open = invoices.filter((i) => i.status === 'sent');
  const summary = {
    devices: {
      total: deviceList.length,
      online: deviceList.filter((d) => d.online).length,
      app_active: deviceList.filter((d) => d.online && d.app_active).length,
      list: deviceList,
    },
    customers: {
      total: customers.length,
      mrr: Math.round(customers.reduce((a, c) => a + c.mrr, 0) * 100) / 100,
      list: customers,
    },
    invoices: {
      open_count: open.length,
      open_sum: Math.round(open.reduce((a, i) => a + i.gross_total, 0) * 100) / 100,
      overdue_count: open.filter((i) => i.due_date && i.due_date < today).length,
      paid_this_year: Math.round(invoices
        .filter((i) => i.status === 'paid' && (i.paid_at || '').startsWith(year))
        .reduce((a, i) => a + i.gross_total, 0) * 100) / 100,
      drafts: invoices.filter((i) => i.status === 'draft').length,
    },
  };
  return ok(summary);
}
