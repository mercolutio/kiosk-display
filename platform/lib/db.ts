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
    })();
  }
  return schemaReady;
}

export { sql };
