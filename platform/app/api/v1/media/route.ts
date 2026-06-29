import { put } from '@vercel/blob';
import { requireApi, ok, err } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/v1/media?filename=foo.jpg — Datei als Roh-Body hochladen -> { url }
// Die zurückgegebene URL kann direkt als `url` einer Seite (type image|video) dienen.
export async function POST(request: Request) {
  const denied = requireApi(request);
  if (denied) return denied;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return err('BLOB_READ_WRITE_TOKEN fehlt', 500);
  const filename = new URL(request.url).searchParams.get('filename') || 'upload';
  const contentType = request.headers.get('content-type') || 'application/octet-stream';
  try {
    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.length === 0) return err('leere Datei', 400);
    const blob = await put(filename, buf, { access: 'public', addRandomSuffix: true, contentType });
    return ok({ url: blob.url, size: buf.length });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
