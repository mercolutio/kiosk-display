import Link from 'next/link';
import { sql, ensureSchema } from '@/lib/db';
import { getCompany, nextInvoiceNumber, normalizeInvoiceRow } from '@/lib/invoices';
import { createInvoice } from '../../actions';
import InvoiceForm, { type PrefillCustomer } from '../InvoiceForm';

export const dynamic = 'force-dynamic';

// Preispolitik (wie Dashboard-MRR): 19,90 €/Display, ab 3 Displays 14,90 €.
const PRICE_STD = 19.9;
const PRICE_VOL = 14.9;
const VOL_FROM = 3;

export default async function NeueRechnung({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  await ensureSchema();
  const company = await getCompany();
  const nextNumber = await nextInvoiceNumber(company.invoice_prefix);

  // Kunden aus den Display-Belegungen ableiten (wie auf der Startseite):
  // gleicher Seitenname = ein Kunde; fakturierte Displays zaehlen.
  let siteRows: any[] = [];
  let deviceRows: any[] = [];
  try { siteRows = (await sql`select device_id, name, invoiced from sites`).rows; } catch {}
  try { deviceRows = (await sql`select id, name from devices`).rows; } catch {}
  const deviceName = new Map<string, string>(deviceRows.map((d: any) => [d.id, d.name] as [string, string]));

  const byKey = new Map<string, { name: string; placements: Map<string, boolean> }>();
  for (const s of siteRows) {
    const name = (s.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let c = byKey.get(key);
    if (!c) { c = { name, placements: new Map() }; byKey.set(key, c); }
    const billed = (c.placements.get(s.device_id) || false) || (s.invoiced !== false);
    c.placements.set(s.device_id, billed);
  }

  // Empfaengerdaten der letzten Rechnung je Kundenname als Vorbelegung.
  let lastByName = new Map<string, any>();
  try {
    const { rows } = await sql`select * from invoices order by created_at desc`;
    for (const r of rows.map(normalizeInvoiceRow)) {
      const key = r.c_name.trim().toLowerCase();
      if (key && !lastByName.has(key)) lastByName.set(key, r);
    }
  } catch {}

  const customers: PrefillCustomer[] = [...byKey.entries()]
    .map(([key, c]) => {
      const billedDevices = [...c.placements.entries()]
        .filter(([, b]) => b)
        .map(([id]) => deviceName.get(id) || 'Display');
      const last = lastByName.get(key);
      return {
        name: c.name,
        devices: billedDevices,
        billed: billedDevices.length,
        rate: billedDevices.length >= VOL_FROM ? PRICE_VOL : PRICE_STD,
        last: last ? {
          contact: last.c_contact || '', street: last.c_street || '', zip: last.c_zip || '',
          city: last.c_city || '', country: last.c_country || 'DE', email: last.c_email || '',
          vat_id: last.c_vat_id || '', reference: last.c_reference || '',
        } : undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  // Auch Empfaenger frueherer Rechnungen anbieten, die (noch) kein Display belegen.
  for (const [key, r] of lastByName) {
    if (!byKey.has(key)) {
      customers.push({
        name: r.c_name, devices: [], billed: 0, rate: PRICE_STD,
        last: {
          contact: r.c_contact || '', street: r.c_street || '', zip: r.c_zip || '',
          city: r.c_city || '', country: r.c_country || 'DE', email: r.c_email || '',
          vat_id: r.c_vat_id || '', reference: r.c_reference || '',
        },
      });
    }
  }

  // Datumsvorgaben: heute, Faelligkeit laut Zahlungsziel, Leistungszeitraum = Monat.
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const issue = iso(now);
  const due = iso(new Date(now.getTime() + company.payment_days * 86400_000));
  const serviceStart = iso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)));
  const serviceEnd = iso(new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)));
  const serviceLabel = now.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  const companyIncomplete = !company.name || !company.street || !company.email
    || (!company.tax_number && !company.vat_id);

  return (
    <div className="container">
      <div className="header">
        <h1><Link href="/rechnungen">← Rechnungen</Link> / Neu</h1>
        <span className="muted">wird angelegt als <strong>{nextNumber}</strong></span>
      </div>

      {companyIncomplete && (
        <div className="card" style={{ borderColor: '#5a4a2a', background: '#242016' }}>
          <strong style={{ color: '#ffd27a' }}>Firmendaten unvollständig</strong>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Für gültige Rechnungen (und die E-Rechnung) fehlen noch eigene Angaben — bitte einmal in den{' '}
            <Link href="/rechnungen/einstellungen">Einstellungen</Link> hinterlegen
            (Name, Adresse, E-Mail, Telefon, Steuernummer/USt-IdNr., IBAN).
          </p>
        </div>
      )}

      <InvoiceForm
        action={createInvoice}
        customers={customers}
        smallBusiness={company.small_business}
        serviceLabel={serviceLabel}
        defaults={{ issue, due, serviceStart, serviceEnd }}
        submitLabel="Rechnung anlegen"
        error={error}
      />
    </div>
  );
}
