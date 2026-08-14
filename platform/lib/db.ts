// Zentraler DB-Zugang. `@vercel/postgres` liest die Connection automatisch aus
// der Umgebungsvariable POSTGRES_URL (von Vercel injiziert).
import { sql } from '@vercel/postgres';

// Idempotente Mini-Migrationen: ergaenzen nachtraeglich hinzugekommene Spalten,
// damit neue Features ohne manuelles Schema-Update sofort funktionieren.
// `add column if not exists` ist ein No-Op, wenn die Spalte schon existiert;
// pro Server-Instanz nur einmal ausgefuehrt (memoisiert).
let schemaReady: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      try { await sql`alter table sites add column if not exists invoiced boolean not null default true`; }
      catch (e) { console.error('[db] ensureSchema sites.invoiced:', (e as Error).message); }
      try { await sql`alter table devices add column if not exists location text`; }
      catch (e) { console.error('[db] ensureSchema devices.location:', (e as Error).message); }
      try { await sql`alter table devices add column if not exists lat double precision`; }
      catch (e) { console.error('[db] ensureSchema devices.lat:', (e as Error).message); }
      try { await sql`alter table devices add column if not exists lng double precision`; }
      catch (e) { console.error('[db] ensureSchema devices.lng:', (e as Error).message); }
      try { await sql`alter table devices add column if not exists pending_stats jsonb not null default '{}'::jsonb`; }
      catch (e) { console.error('[db] ensureSchema devices.pending_stats:', (e as Error).message); }
      try { await sql`alter table devices add column if not exists stats_flushed_at timestamptz`; }
      catch (e) { console.error('[db] ensureSchema devices.stats_flushed_at:', (e as Error).message); }
      try {
        await sql`create table if not exists contracts (
          id            uuid primary key default gen_random_uuid(),
          name          text not null,
          url           text not null,
          content_type  text,
          size          int,
          note          text,
          category      text not null default 'blanko',  -- 'blanko' | 'unterschrieben'
          device_id     uuid references devices(id) on delete set null,
          created_at    timestamptz not null default now()
        )`;
      } catch (e) { console.error('[db] ensureSchema contracts:', (e as Error).message); }
      try { await sql`alter table contracts add column if not exists category text not null default 'blanko'`; }
      catch (e) { console.error('[db] ensureSchema contracts.category:', (e as Error).message); }
      // Rechnungsmodul: eigene Firmendaten (eine Zeile), Rechnungen + Positionen.
      try {
        await sql`create table if not exists company_settings (
          id             int primary key default 1 check (id = 1),
          name           text,
          owner          text,
          street         text,
          zip            text,
          city           text,
          country        text not null default 'DE',
          email          text,
          phone          text,
          website        text,
          tax_number     text,                              -- Steuernummer
          vat_id         text,                              -- USt-IdNr.
          iban           text,
          bic            text,
          bank_name      text,
          small_business boolean not null default false,    -- § 19 UStG (keine USt)
          payment_days   int not null default 14,
          invoice_prefix text not null default 'RE',
          invoice_footer text,
          updated_at     timestamptz not null default now()
        )`;
      } catch (e) { console.error('[db] ensureSchema company_settings:', (e as Error).message); }
      try {
        await sql`create table if not exists invoices (
          id             uuid primary key default gen_random_uuid(),
          number         text not null unique,
          status         text not null default 'draft' check (status in ('draft','sent','paid','cancelled')),
          issue_date     date not null default current_date,
          due_date       date,
          service_start  date,                               -- Leistungszeitraum
          service_end    date,
          c_name         text not null,                      -- Empfaenger-Schnappschuss
          c_contact      text,
          c_street       text,
          c_zip          text,
          c_city         text,
          c_country      text not null default 'DE',
          c_email        text,
          c_vat_id       text,
          c_reference    text,                               -- Kaeufer-Referenz / Leitweg-ID
          note           text,
          small_business boolean not null default false,
          net_total      numeric(12,2) not null default 0,
          tax_total      numeric(12,2) not null default 0,
          gross_total    numeric(12,2) not null default 0,
          paid_at        date,
          created_at     timestamptz not null default now()
        )`;
      } catch (e) { console.error('[db] ensureSchema invoices:', (e as Error).message); }
      try {
        await sql`create table if not exists invoice_items (
          id          uuid primary key default gen_random_uuid(),
          invoice_id  uuid not null references invoices(id) on delete cascade,
          position    int not null default 0,
          description text not null,
          quantity    numeric(12,2) not null default 1,
          unit        text not null default 'C62',           -- UN/ECE: C62 Stk, MON Monat, HUR Std, DAY Tag
          unit_price  numeric(12,2) not null default 0,
          vat_rate    numeric(5,2) not null default 19
        )`;
        await sql`create index if not exists invoice_items_invoice on invoice_items (invoice_id, position)`;
      } catch (e) { console.error('[db] ensureSchema invoice_items:', (e as Error).message); }
    })();
  }
  return schemaReady;
}

export { sql };
