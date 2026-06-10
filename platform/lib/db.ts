// Zentraler DB-Zugang. `@vercel/postgres` liest die Connection automatisch aus
// der Umgebungsvariable POSTGRES_URL (von Vercel injiziert).
import { sql } from '@vercel/postgres';

export { sql };
