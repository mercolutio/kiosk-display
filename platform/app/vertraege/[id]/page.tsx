import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql, ensureSchema } from '@/lib/db';
import PdfFiller from './PdfFiller';

export const dynamic = 'force-dynamic';

export default async function FillContract({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureSchema();

  let c: any = null;
  try {
    c = (await sql`select id, name, url, content_type from contracts where id = ${id} limit 1`).rows[0] || null;
  } catch { /* contracts evtl. nicht erreichbar */ }
  if (!c) notFound();

  const isPdf =
    (c.content_type || '').includes('pdf') ||
    /\.pdf$/i.test(c.name || '') ||
    /\.pdf(\?|$)/i.test(c.url || '');

  return (
    <div className="container">
      <div className="header">
        <h1><Link href="/vertraege">← Verträge</Link> / Ausfüllen</h1>
      </div>
      <div className="card">
        <h2>{c.name}</h2>
        {isPdf ? (
          <PdfFiller fileUrl={`/api/contract-file?id=${c.id}`} downloadName={`${c.name}-ausgefuellt.pdf`} />
        ) : (
          <p className="muted">Ausfüllen funktioniert nur mit PDF-Dateien. Diese Datei ist kein PDF.</p>
        )}
      </div>
    </div>
  );
}
