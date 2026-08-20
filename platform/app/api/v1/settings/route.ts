// REST-API: Firmendaten / Rechnungs-Einstellungen lesen und schreiben.
//   GET /api/v1/settings   -> aktuelle Einstellungen (SMTP-Passwort maskiert)
//   PUT /api/v1/settings   -> Teil-Update: nur mitgeschickte Felder werden geaendert
//
// Felder: name, owner, street, zip, city, country, email, phone, website,
//         tax_number, vat_id, iban, bic, bank_name, small_business,
//         payment_days, invoice_prefix, invoice_footer,
//         smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_bcc
import { sql, ensureSchema } from '@/lib/db';
import { requireApi, ok, err, readJson } from '@/lib/api';
import { getCompany } from '@/lib/invoices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(c: any) {
  const { smtp_pass, ...rest } = c;
  return { ...rest, smtp_pass_set: !!smtp_pass };
}

export async function GET(request: Request) {
  const denied = requireApi(request);
  if (denied) return denied;
  await ensureSchema();
  return ok({ settings: serialize(await getCompany()) });
}

export async function PUT(request: Request) {
  const denied = requireApi(request);
  if (denied) return denied;
  await ensureSchema();
  const body = await readJson(request);
  const cur = await getCompany();

  const str = (k: string, curVal: string) =>
    body[k] !== undefined ? String(body[k] ?? '').trim() : curVal;
  const c = {
    name: str('name', cur.name),
    owner: str('owner', cur.owner),
    street: str('street', cur.street),
    zip: str('zip', cur.zip),
    city: str('city', cur.city),
    country: (str('country', cur.country) || 'DE').toUpperCase().slice(0, 2),
    email: str('email', cur.email),
    phone: str('phone', cur.phone),
    website: str('website', cur.website),
    tax_number: str('tax_number', cur.tax_number),
    vat_id: str('vat_id', cur.vat_id),
    iban: str('iban', cur.iban),
    bic: str('bic', cur.bic),
    bank_name: str('bank_name', cur.bank_name),
    small_business: body.small_business !== undefined ? !!body.small_business : cur.small_business,
    payment_days: body.payment_days !== undefined
      ? Math.max(0, parseInt(String(body.payment_days), 10) || 14) : cur.payment_days,
    invoice_prefix: body.invoice_prefix !== undefined
      ? (String(body.invoice_prefix).replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'RE') : cur.invoice_prefix,
    invoice_footer: str('invoice_footer', cur.invoice_footer),
    smtp_host: str('smtp_host', cur.smtp_host),
    smtp_port: body.smtp_port !== undefined
      ? (parseInt(String(body.smtp_port), 10) || 587) : (cur.smtp_port || 587),
    smtp_user: str('smtp_user', cur.smtp_user),
    // Passwort nur ueberschreiben, wenn explizit (nicht-leer) mitgeschickt.
    smtp_pass: (body.smtp_pass !== undefined && String(body.smtp_pass).trim() !== '')
      ? String(body.smtp_pass).trim() : cur.smtp_pass,
    smtp_from: str('smtp_from', cur.smtp_from),
    smtp_bcc: str('smtp_bcc', cur.smtp_bcc),
  };

  try {
    await sql`
      insert into company_settings (id, name, owner, street, zip, city, country, email, phone, website,
                                    tax_number, vat_id, iban, bic, bank_name,
                                    small_business, payment_days, invoice_prefix, invoice_footer,
                                    smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_bcc, updated_at)
      values (1, ${c.name}, ${c.owner}, ${c.street}, ${c.zip}, ${c.city}, ${c.country},
              ${c.email}, ${c.phone}, ${c.website},
              ${c.tax_number}, ${c.vat_id}, ${c.iban}, ${c.bic}, ${c.bank_name},
              ${c.small_business}, ${c.payment_days}, ${c.invoice_prefix}, ${c.invoice_footer},
              ${c.smtp_host}, ${c.smtp_port}, ${c.smtp_user}, ${c.smtp_pass}, ${c.smtp_from}, ${c.smtp_bcc}, now())
      on conflict (id) do update set
        name = excluded.name, owner = excluded.owner, street = excluded.street,
        zip = excluded.zip, city = excluded.city, country = excluded.country,
        email = excluded.email, phone = excluded.phone, website = excluded.website,
        tax_number = excluded.tax_number, vat_id = excluded.vat_id,
        iban = excluded.iban, bic = excluded.bic, bank_name = excluded.bank_name,
        small_business = excluded.small_business, payment_days = excluded.payment_days,
        invoice_prefix = excluded.invoice_prefix, invoice_footer = excluded.invoice_footer,
        smtp_host = excluded.smtp_host, smtp_port = excluded.smtp_port,
        smtp_user = excluded.smtp_user, smtp_pass = excluded.smtp_pass,
        smtp_from = excluded.smtp_from, smtp_bcc = excluded.smtp_bcc,
        updated_at = now()
    `;
  } catch (e) {
    return err('DB-Fehler: ' + (e as Error).message, 500);
  }
  return ok({ settings: serialize(await getCompany()) });
}
