// Liefert eine Vertragsdatei aus dem Blob-Store SAME-ORIGIN aus (per Vertrags-ID).
// So können pdf.js (Anzeige) und pdf-lib (Ausfüllen) die Datei ohne CORS laden.
// Session-geschützt (zusätzlich zur Middleware).
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken, SESSION_COOKIE } from '@/lib/auth';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifyToken(session))) return new NextResponse('nicht angemeldet', { status: 401 });

  const id = new URL(request.url).searchParams.get('id') || '';
  let url = '';
  try {
    const r = await sql`select url from contracts where id = ${id} limit 1`;
    url = r.rows[0]?.url || '';
  } catch { /* contracts evtl. nicht erreichbar */ }
  if (!url) return new NextResponse('nicht gefunden', { status: 404 });

  try {
    const res = await fetch(url);
    if (!res.ok) return new NextResponse('Datei nicht abrufbar', { status: 502 });
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/pdf',
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (e) {
    return new NextResponse('Fehler: ' + (e as Error).message, { status: 502 });
  }
}
