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
      try {
        await sql`alter table sites add column if not exists invoiced boolean not null default true`;
      } catch (e) {
        console.error('[db] ensureSchema:', (e as Error).message);
      }
    })();
  }
  return schemaReady;
}

export { sql };
