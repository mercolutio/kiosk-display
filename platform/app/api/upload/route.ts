// Server-seitiger Upload nach Vercel Blob: der Browser schickt die Datei als
// Roh-Body an diese Route, der Server legt sie im Blob-Store ab (put). Vorteil
// ggü. dem Client-Upload: funktioniert auch in Netzen, die den direkten
// Browser->Blob-Transfer blockieren — ohne CORS, ohne Client-Token.
// Limit ~4,5 MB pro Datei (Vercel-Function-Body); Bilder werden im Browser
// vorab auf Display-Groesse verkleinert, Videos clientseitig vor dem Senden geprueft.
import { put } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifyToken(session))) {
    return NextResponse.json({ error: 'nicht angemeldet' }, { status: 401 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: 'BLOB_READ_WRITE_TOKEN fehlt' }, { status: 500 });
  }
  const filename = new URL(request.url).searchParams.get('filename') || 'upload';
  const contentType = request.headers.get('content-type') || 'application/octet-stream';
  try {
    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.length === 0) return NextResponse.json({ error: 'leere Datei' }, { status: 400 });
    const blob = await put(filename, buf, { access: 'public', addRandomSuffix: true, contentType });
    console.log('[upload] gespeichert:', blob.url, '(' + buf.length + ' bytes)');
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    console.error('[upload] Fehler:', (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
