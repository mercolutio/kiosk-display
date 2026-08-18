// Gemeinsame Typen + Helfer fuers Rechnungsmodul (Liste, PDF, XRechnung).
import { sql, ensureSchema } from '@/lib/db';

export type Company = {
  name: string; owner: string; street: string; zip: string; city: string; country: string;
  email: string; phone: string; website: string;
  tax_number: string; vat_id: string;
  iban: string; bic: string; bank_name: string;
  small_business: boolean; payment_days: number; invoice_prefix: string; invoice_footer: string;
};

export type InvoiceItem = {
  position: number;
  description: string;
  quantity: number;
  unit: string;        // UN/ECE-Code: C62, MON, HUR, DAY
  unit_price: number;  // Netto-Einzelpreis
  vat_rate: number;    // 19 | 7 | 0
};

export type Invoice = {
  id: string;
  number: string;
  status: 'draft' | 'sent' | 'paid' | 'cancelled';
  issue_date: string;         // YYYY-MM-DD
  due_date: string | null;
  service_start: string | null;
  service_end: string | null;
  c_name: string; c_contact: string | null;
  c_street: string | null; c_zip: string | null; c_city: string | null; c_country: string;
  c_email: string | null; c_vat_id: string | null; c_reference: string | null;
  note: string | null;
  small_business: boolean;
  net_total: number; tax_total: number; gross_total: number;
  paid_at: string | null;
};

export const UNITS: Record<string, string> = {
  C62: 'Stk.',
  MON: 'Monat(e)',
  HUR: 'Std.',
  DAY: 'Tag(e)',
};

export const STATUS_LABEL: Record<Invoice['status'], string> = {
  draft: 'Entwurf',
  sent: 'Offen',
  paid: 'Bezahlt',
  cancelled: 'Storniert',
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const eur = (v: number) =>
  v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

// Datum als YYYY-MM-DD normalisieren (Postgres date kommt je nach Treiber als
// Date-Objekt oder String zurueck).
export function isoDate(d: unknown): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  const s = String(d);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

export function fmtDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

// Summen aus Positionen: Netto, USt je Satz, Brutto. Rundung: je Zeile auf
// 2 Stellen, USt je Steuersatz-Gruppe auf 2 Stellen (uebliche Praxis, deckt
// sich mit EN-16931-Berechnungsregeln).
export function computeTotals(items: InvoiceItem[]) {
  const byRate = new Map<number, number>(); // Satz -> Nettosumme
  let net = 0;
  for (const it of items) {
    const line = round2(it.quantity * it.unit_price);
    net = round2(net + line);
    byRate.set(it.vat_rate, round2((byRate.get(it.vat_rate) || 0) + line));
  }
  const taxByRate = [...byRate.entries()]
    .filter(([rate]) => rate > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([rate, base]) => ({ rate, base, tax: round2(base * rate / 100) }));
  const tax = round2(taxByRate.reduce((a, t) => a + t.tax, 0));
  return { net, tax, gross: round2(net + tax), taxByRate, byRate };
}

const COMPANY_DEFAULTS: Company = {
  name: '', owner: '', street: '', zip: '', city: '', country: 'DE',
  email: '', phone: '', website: '',
  tax_number: '', vat_id: '',
  iban: '', bic: '', bank_name: '',
  small_business: false, payment_days: 14, invoice_prefix: 'RE', invoice_footer: '',
};

export async function getCompany(): Promise<Company> {
  await ensureSchema();
  try {
    const { rows } = await sql`select * from company_settings where id = 1`;
    if (!rows[0]) return { ...COMPANY_DEFAULTS };
    const r = rows[0];
    return {
      name: r.name || '', owner: r.owner || '', street: r.street || '',
      zip: r.zip || '', city: r.city || '', country: r.country || 'DE',
      email: r.email || '', phone: r.phone || '', website: r.website || '',
      tax_number: r.tax_number || '', vat_id: r.vat_id || '',
      iban: r.iban || '', bic: r.bic || '', bank_name: r.bank_name || '',
      small_business: !!r.small_business,
      payment_days: Number(r.payment_days) || 14,
      invoice_prefix: r.invoice_prefix || 'RE',
      invoice_footer: r.invoice_footer || '',
    };
  } catch {
    return { ...COMPANY_DEFAULTS };
  }
}

// Naechste fortlaufende Rechnungsnummer: <Prefix>-JJJJ-MM-<lfd. Nr, 4-stellig>,
// fortlaufend je Monat (z. B. RE-2026-08-0001). Aeltere Nummern im alten
// Format (RE-JJJJ-NNNN) bleiben unveraendert gueltig und werden ignoriert.
export async function nextInvoiceNumber(prefix: string): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const like = `${prefix}-${year}-${month}-%`;
  let max = 0;
  try {
    const { rows } = await sql`select number from invoices where number like ${like}`;
    for (const r of rows) {
      const n = parseInt(String(r.number).split('-').pop() || '0', 10);
      if (n > max) max = n;
    }
  } catch { /* Tabelle evtl. noch nicht angelegt */ }
  return `${prefix}-${year}-${month}-${String(max + 1).padStart(4, '0')}`;
}

export function normalizeInvoiceRow(r: any): Invoice {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    issue_date: isoDate(r.issue_date) || '',
    due_date: isoDate(r.due_date),
    service_start: isoDate(r.service_start),
    service_end: isoDate(r.service_end),
    c_name: r.c_name || '',
    c_contact: r.c_contact || null,
    c_street: r.c_street || null,
    c_zip: r.c_zip || null,
    c_city: r.c_city || null,
    c_country: r.c_country || 'DE',
    c_email: r.c_email || null,
    c_vat_id: r.c_vat_id || null,
    c_reference: r.c_reference || null,
    note: r.note || null,
    small_business: !!r.small_business,
    net_total: Number(r.net_total) || 0,
    tax_total: Number(r.tax_total) || 0,
    gross_total: Number(r.gross_total) || 0,
    paid_at: isoDate(r.paid_at),
  };
}

export function normalizeItemRow(r: any): InvoiceItem {
  return {
    position: Number(r.position) || 0,
    description: r.description || '',
    quantity: Number(r.quantity) || 0,
    unit: r.unit || 'C62',
    unit_price: Number(r.unit_price) || 0,
    vat_rate: Number(r.vat_rate) || 0,
  };
}

export async function loadInvoice(id: string): Promise<{ invoice: Invoice; items: InvoiceItem[] } | null> {
  await ensureSchema();
  try {
    const { rows } = await sql`select * from invoices where id = ${id} limit 1`;
    if (!rows[0]) return null;
    const itemsRes = await sql`
      select * from invoice_items where invoice_id = ${id} order by position asc
    `;
    return { invoice: normalizeInvoiceRow(rows[0]), items: itemsRes.rows.map(normalizeItemRow) };
  } catch {
    return null;
  }
}
