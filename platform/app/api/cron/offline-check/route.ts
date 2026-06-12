// Optionaler Endpoint, um Offline-Alarme auch dann auszuloesen, wenn KEIN Geraet
// mehr syncen kann (z. B. die ganze Flotte offline). Per externem Pinger (z. B.
// cron-job.org, alle paar Minuten) aufrufen:
//   GET /api/cron/offline-check?secret=<CRON_SECRET>
// Geschuetzt per CRON_SECRET (Header Bearer oder ?secret=).
import { checkOfflineAndAlert } from '@/lib/alerts';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET || '';
  const auth = req.headers.get('authorization') || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (url.searchParams.get('secret') || '');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const alerted = await checkOfflineAndAlert();
  return NextResponse.json({ ok: true, newlyOffline: alerted });
}
