import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken, SESSION_COOKIE } from '@/lib/auth';

// Schuetzt alle Seiten ausser /login. Die Agent-API (/api/agent/*) sichert sich
// per Geraete-Token; die Cron-Routen (/api/cron/*) per CRON_SECRET; der Blob-
// Upload (/api/upload) prueft die Session selbst; die oeffentliche REST-API
// (/api/v1/*) sichert sich per KIOSK_API_KEY — daher per Matcher ausgenommen.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/login')) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifyToken(token)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/agent|api/cron|api/upload|api/v1).*)'],
};
