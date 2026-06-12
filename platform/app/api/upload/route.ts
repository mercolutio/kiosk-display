// Datei-Upload (Bilder/Videos) nach Vercel Blob — Client-Upload-Flow, damit
// auch groessere Videos nicht am 4,5-MB-Limit der Serverless-Funktion scheitern.
// Per Matcher aus der Auth-Middleware ausgenommen; die Session wird hier selbst
// geprueft (nur eingeloggte Admins duerfen Tokens erzeugen).
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const session = (await cookies()).get(SESSION_COOKIE)?.value;
        if (!(await verifyToken(session))) throw new Error('nicht angemeldet');
        return {
          allowedContentTypes: [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
            'video/mp4', 'video/webm', 'video/ogg',
          ],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100 MB
        };
      },
      onUploadCompleted: async () => { /* nichts noetig: Client bekommt die URL direkt */ },
    });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
